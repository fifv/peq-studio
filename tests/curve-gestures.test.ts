import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { installCurveSlide } from '../src/ui/curve-slide.ts';
import { installCurveReordering } from '../src/ui/curve-reorder.ts';

class Node extends EventTarget {
  dataset: Record<string, string> = {};
  disabled = false;
  scrollTop = 0;
  capture = new Set<number>();
  classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
  };
  parent?: Node;
  children: Node[] = [];
  constructor(
    public selector = '',
    public top = 0,
  ) {
    super();
  }
  closest(selector: string): Node | null {
    return selector === this.selector ? this : (this.parent?.closest(selector) ?? null);
  }
  querySelectorAll(selector: string): Node[] {
    return this.children.flatMap((child) => [
      ...(child.selector === selector ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  contains(node: Node): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  focus() {}
  setPointerCapture(id: number) {
    this.capture.add(id);
  }
  releasePointerCapture(id: number) {
    this.capture.delete(id);
  }
  hasPointerCapture(id: number) {
    return this.capture.has(id);
  }
  getBoundingClientRect() {
    return { left: 0, right: 300, top: this.top, bottom: this.top + 100, height: 100 };
  }
  append(node: Node) {
    node.parent = this;
    this.children.push(node);
    return node;
  }
}
function fixture(t: TestContext) {
  const root = new Node(),
    list = root.append(new Node('.curve-list'));
  const rows = ['a', 'b', 'c'].map((id, index) => {
    const row = list.append(new Node('[data-custom-curve]', index * 100));
    row.dataset.customCurve = id;
    const choice = row.append(new Node('.curve-choice'));
    choice.dataset.curveId = id;
    const handle = row.append(new Node('[data-curve-reorder]'));
    handle.dataset.curveReorder = id;
    return { row, choice, handle };
  });
  let hit: Node | null = null;
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  const windowTarget = new EventTarget();
  for (const [key, value] of Object.entries({
    Element: Node,
    window: windowTarget,
    document: { elementFromPoint: () => hit },
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      frames.set(++serial, fn);
      return serial;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (before) Object.defineProperty(globalThis, key, before);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  function fire(type: string, target = root, extra = {}) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(
      event,
      Object.fromEntries(
        Object.entries({
          target,
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          buttons: 1,
          clientX: 50,
          clientY: 50,
          ...extra,
        }).map(([key, value]) => [key, { value }]),
      ),
    );
    root.dispatchEvent(event);
    return event;
  }
  return {
    root,
    rows,
    frames,
    windowTarget,
    fire,
    hit: (node: Node) => {
      hit = node;
    },
  };
}

test('curve slide selects on press and across rows, avoids duplicates, and releases capture', (t) => {
  const ui = fixture(t),
    selected: string[] = [];
  const slide = installCurveSlide(ui.root as unknown as HTMLElement, (id) => selected.push(id));
  ui.fire('pointerdown', ui.rows[0].choice);
  const group = slide.group;
  assert.equal(typeof group, 'symbol');
  assert.deepEqual(selected, ['a']);
  assert.equal(ui.root.hasPointerCapture(1), true);
  ui.hit(ui.rows[1].choice);
  ui.fire('pointermove');
  ui.fire('pointermove');
  ui.hit(ui.rows[2].choice);
  ui.fire('pointermove');
  assert.deepEqual(selected, ['a', 'b', 'c']);
  assert.equal(slide.group, group);
  ui.fire('pointerup');
  assert.equal(slide.group, undefined);
  assert.equal(slide.active, false);
  assert.equal(ui.root.hasPointerCapture(1), false);
  assert.equal(ui.fire('click').defaultPrevented, true);
  ui.fire('pointerdown', ui.rows[2].choice);
  assert.notEqual(slide.group, group);
  ui.fire('pointerup');
  slide.dispose();
  ui.fire('pointerdown', ui.rows[0].choice);
  assert.deepEqual(selected, ['a', 'b', 'c', 'c']);
});

test('touch scrolling and reorder handles do not trigger slide selection', (t) => {
  const ui = fixture(t),
    selected: string[] = [];
  const slide = installCurveSlide(ui.root as unknown as HTMLElement, (id) => selected.push(id));
  ui.fire('pointerdown', ui.rows[0].choice, { pointerType: 'touch' });
  ui.fire('pointerdown', ui.rows[0].handle);
  assert.deepEqual(selected, []);
  assert.equal(slide.active, false);
  slide.dispose();
});

test('collection tabs switch on press and slide despite redraws without selecting curve rows', (t) => {
  const ui = fixture(t),
    selected: string[] = [],
    collections: string[] = [];
  function tab(id: string) {
    const node = ui.root.append(new Node('[data-view]'));
    node.dataset.view = id;
    return node;
  }
  const custom = tab('custom');
  const slide = installCurveSlide(
    ui.root as unknown as HTMLElement,
    (id) => selected.push(id),
    (id) => {
      collections.push(id);
      // Replacing the pressed tab must not lose capture on the popup.
      ui.root.children = ui.root.children.filter((child) => child.selector !== '[data-view]');
    },
  );
  ui.fire('pointerdown', custom);
  assert.equal(ui.root.hasPointerCapture(1), true);
  ui.hit(tab('target'));
  ui.fire('pointermove');
  ui.hit(ui.rows[0].choice);
  ui.fire('pointermove');
  ui.hit(tab('source'));
  ui.fire('pointermove');
  ui.fire('pointerup');
  assert.deepEqual(collections, ['custom', 'target', 'source']);
  assert.deepEqual(selected, []);
  assert.equal(ui.root.hasPointerCapture(1), false);
  assert.equal(ui.fire('click').defaultPrevented, true);
  slide.dispose();
});

test('curve grips reorder once on drop and cancel cleanly on Escape or disposal', (t) => {
  const ui = fixture(t),
    moves: unknown[] = [];
  const reorder = installCurveReordering(ui.root as unknown as HTMLElement, (...args) =>
    moves.push(args),
  );
  ui.fire('pointerdown', ui.rows[0].handle);
  ui.hit(ui.rows[2].choice);
  ui.fire('pointermove', ui.root, { clientY: 290 });
  assert.equal(ui.rows[2].row.classes.has('reorder-after'), true);
  assert.deepEqual(moves, []);
  ui.fire('pointerup');
  assert.deepEqual(moves, [['a', 'c', true]]);
  assert.equal(ui.frames.size, 0);
  ui.fire('pointerdown', ui.rows[0].handle);
  ui.fire('pointermove', ui.root, { clientY: 210 });
  ui.fire('keydown', ui.rows[0].handle, { key: 'Escape' });
  ui.fire('pointerup');
  assert.equal(moves.length, 1);
  ui.fire('keydown', ui.rows[1].handle, { key: 'ArrowUp' });
  assert.deepEqual(moves[1], ['b', 'a', false]);
  ui.fire('pointerdown', ui.rows[0].handle);
  reorder.dispose();
  assert.equal(ui.rows[0].handle.hasPointerCapture(1), false);
  ui.fire('pointermove', ui.root, { clientY: 290 });
  ui.fire('pointerup');
  assert.equal(moves.length, 2);
});
