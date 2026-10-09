import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/ui/chart.ts';
import { initialState, newBand } from '../src/model.ts';

class Node extends EventTarget {
  innerHTML = '';
  textContent = '';
  className = '';
  disabled = false;
  clientWidth = 1000;
  clientHeight = 400;
  dataset: Record<string, string> = {};
  capture = new Set<number>();
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, on: boolean) =>
      on ? this.classes.add(name) : this.classes.delete(name),
  };
  setAttribute() {}
  querySelector() {
    return null;
  }
  closest(selector: string) {
    return selector === '[data-point]' && this.dataset.point !== undefined ? this : null;
  }
  createSVGPoint() {
    return {
      x: 0,
      y: 0,
      matrixTransform() {
        return { x: this.x, y: this.y };
      },
    };
  }
  getScreenCTM() {
    return { inverse: () => ({}) };
  }
  setPointerCapture(id: number) {
    this.capture.add(id);
  }
  hasPointerCapture(id: number) {
    return this.capture.has(id);
  }
  releasePointerCapture(id: number) {
    this.capture.delete(id);
  }
}

function fixture(t: TestContext) {
  const nodes = new Map<string, Node>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return nodes.get(selector)!;
  };
  const windowTarget = new EventTarget();
  for (const [key, value] of Object.entries({
    Element: Node,
    document: { querySelector: node },
    window: windowTarget,
    ResizeObserver: class {
      observe() {}
    },
    requestAnimationFrame: () => 1,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const state = initialState();
  state.presets[0].targetId = '';
  state.presets[0].sourceId = '';
  const channel = state.presets[0].left;
  channel.filters = [newBand(100, 0), newBand(1000, 5), newBand(10000, -5)];
  const selectionRequests: { index: number; toggle?: boolean; range?: boolean }[] = [];
  const qRequests: number[][] = [];
  let selected: number[] = [],
    begins = 0,
    ends = 0;
  const chart = createChart({
    getState: () => state,
    getChannel: () => channel,
    getSelected: () => selected[0] ?? -1,
    getSelection: () => selected,
    getLayers: () => ({
      target: false,
      source: false,
      bands: false,
      combined: true,
      filtered: false,
    }),
    onViewChange: (view) => Object.assign(state.chartView, view),
    onSelect: (index, toggle, range) => {
      selectionRequests.push({ index, toggle, range });
      selected = toggle
        ? selected.includes(index)
          ? selected.filter((i) => i !== index)
          : [...selected, index]
        : [index];
    },
    onSelectMany: (indices) => {
      selected = indices;
    },
    onBegin: () => {
      begins++;
    },
    onChange() {},
    onEnd: () => {
      ends++;
    },
    onAdd() {},
    onCommit() {},
    onAdjustQ(indices) {
      qRequests.push(indices);
    },
  });
  chart.draw();
  const svg = node('#chart');
  function pointer(type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(
      event,
      Object.fromEntries(
        Object.entries({
          clientX: x,
          clientY: y,
          pointerId: 1,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerType: 'mouse',
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          ...extra,
        }).map(([key, value]) => [key, { value }]),
      ),
    );
    svg.dispatchEvent(event);
  }
  return {
    chart,
    state,
    channel,
    svg,
    node,
    pointer,
    selected: () => selected,
    selectionRequests,
    qRequests,
    history: () => ({ begins, ends }),
    windowTarget,
  };
}

test('Shift-drag selects graph handles without editing or adding undo; cancellation leaves selection intact', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown', 200, 130, { shiftKey: true });
  f.pointer('pointermove', 650, 230);
  assert.match(f.node('#band-selection-box').innerHTML, /width="450"/);
  f.pointer('pointerup', 650, 230);
  assert.deepEqual(f.selected(), [0, 1]);
  assert.deepEqual(f.history(), { begins: 0, ends: 0 });
  f.pointer('pointerdown', 800, 200, { shiftKey: true });
  f.pointer('pointermove', 960, 300);
  f.pointer('pointercancel', 960, 300);
  assert.deepEqual(f.selected(), [0, 1]);
  assert.equal(f.svg.capture.size, 0);
  assert.equal(f.node('#band-selection-box').innerHTML, '');
});

test('additive rectangles, Ctrl-click and group drag keep selected bands together', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown', 200, 130, { shiftKey: true });
  f.pointer('pointermove', 650, 230);
  f.pointer('pointerup', 650, 230);
  f.pointer('pointerdown', 800, 180, { shiftKey: true, ctrlKey: true });
  f.pointer('pointermove', 950, 260);
  f.pointer('pointerup', 950, 260);
  assert.deepEqual(f.selected(), [0, 1, 2]);
  const point = new Node();
  point.dataset.point = '2';
  f.pointer('pointerdown', 900, 220, { target: point, ctrlKey: true });
  assert.deepEqual(f.selected(), [0, 1]);
  point.dataset.point = '0';
  const untouched = { ...f.channel.filters[2] };
  f.pointer('pointerdown', 270, 185, { target: point });
  f.pointer('pointermove', 300, 170);
  f.pointer('pointerup', 300, 170);
  assert.ok(Math.abs(f.channel.filters[1].fcHz / f.channel.filters[0].fcHz - 10) < 0.00001);
  assert.equal(f.channel.filters[1].gainDb - f.channel.filters[0].gainDb, 5);
  assert.deepEqual(f.channel.filters[2], untouched);
  assert.deepEqual(f.history(), { begins: 1, ends: 1 });
  f.channel.filters[0].enabled = false;
  f.chart.draw();
  assert.match(f.svg.innerHTML, /data-point="0"/);
});

test('ordinary dragging continues to pan a zoomed graph', (t) => {
  const f = fixture(t);
  Object.assign(f.state.chartView, { minHz: 100, maxHz: 1000 });
  f.chart.draw();
  f.pointer('pointerdown', 400, 300);
  f.pointer('pointermove', 450, 300);
  f.pointer('pointerup', 450, 300);
  assert.ok(f.state.chartView.minHz < 100);
  assert.deepEqual(f.selected(), []);
  assert.deepEqual(f.history(), { begins: 0, ends: 0 });
});

test('Shift-click on a graph handle requests range selection without dragging or editing', (t) => {
  const f = fixture(t);
  const point = new Node();
  point.dataset.point = '2';
  f.pointer('pointerdown', 900, 220, { target: point, shiftKey: true });
  assert.deepEqual(f.selectionRequests, [{ index: 2, toggle: false, range: true }]);
  assert.deepEqual(f.history(), { begins: 0, ends: 0 });
  assert.equal(f.svg.capture.size, 0);
});

test('graph clicks collapse selection or clear it without an undo entry', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown', 200, 130, { shiftKey: true });
  f.pointer('pointermove', 650, 230);
  f.pointer('pointerup', 650, 230);
  const point = new Node();
  point.dataset.point = '0';
  f.pointer('pointerdown', 270, 185, { target: point });
  f.pointer('pointerup', 270, 185);
  assert.deepEqual(f.selected(), [0]);
  f.pointer('pointerdown', 700, 300);
  f.pointer('pointerup', 700, 300);
  assert.deepEqual(f.selected(), []);
  assert.deepEqual(f.history(), { begins: 0, ends: 0 });
});

test('graph wheel adjusts the whole selection on blank space or selected handles and preserves Shift zoom', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown', 200, 130, { shiftKey: true });
  f.pointer('pointermove', 650, 230);
  f.pointer('pointerup', 650, 230);
  f.pointer('wheel', 600, 240, { deltaY: -100 });
  const point = new Node();
  point.dataset.point = '0';
  f.pointer('wheel', 270, 185, { target: point, deltaY: -100 });
  assert.deepEqual(f.qRequests, [
    [0, 1],
    [0, 1],
  ]);
  f.pointer('wheel', 600, 240, { deltaY: -100, shiftKey: true });
  assert.equal(f.qRequests.length, 2);
  assert.ok(f.state.chartView.maxHz / f.state.chartView.minHz < 1000);
});
