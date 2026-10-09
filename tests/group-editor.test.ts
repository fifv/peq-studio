import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorControls } from '../src/ui/editor-controls.ts';
import { initialState, newBand } from '../src/model.ts';

test('group inputs support relative typing, dragging and fine wheel adjustment', async (t) => {
  class Input extends EventTarget {
    dataset: Record<string, string>;
    type = 'number';
    value = '';
    min = '';
    max = '';
    capture = false;
    constructor(name: string) {
      super();
      this.dataset = { adjust: name };
    }
    closest(selector: string) {
      return selector === '[data-adjust]' ? this : null;
    }
    matches(selector: string) {
      return ['[data-adjust]', 'input[type=number]'].includes(selector);
    }
    hasAttribute() {
      return false;
    }
    setPointerCapture() {
      this.capture = true;
    }
    hasPointerCapture() {
      return this.capture;
    }
    releasePointerCapture() {
      this.capture = false;
    }
    focus() {}
    select() {}
  }
  const inputs = ['group-frequency', 'group-gain', 'group-q'].map((name) => new Input(name));
  const documentTarget = Object.assign(new EventTarget(), {
    querySelectorAll: (selector: string) => (selector === '[data-adjust]' ? inputs : []),
    body: { classList: { add() {}, remove() {} } },
  });
  for (const [key, value] of Object.entries({
    document: documentTarget,
    window: new EventTarget(),
    Element: Input,
    HTMLElement: Input,
    HTMLInputElement: Input,
  })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      before
        ? Object.defineProperty(globalThis, key, before)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const state = initialState(),
    channel = state.presets[0].left;
  channel.filters = [newBand(100, -3), newBand(1000, 4)];
  channel.filters[0].q = 0.5;
  channel.filters[1].q = 5;
  let begins = 0,
    ends = 0;
  createEditorControls({
    getState: () => state,
    getChannel: () => channel,
    getSelected: () => 0,
    getSelection: () => [0, 1],
    onSelect() {},
    onBegin: () => {
      begins++;
    },
    onChange() {},
    onEnd: () => {
      ends++;
    },
    onRefresh() {},
  });
  function send(type: string, target: Input, extra: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      target,
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 100,
      deltaY: -100,
      shiftKey: false,
      altKey: false,
      ...extra,
    }))
      Object.defineProperty(event, key, { value });
    documentTarget.dispatchEvent(event);
  }
  send('wheel', inputs[0]);
  assert.equal(inputs[0].value, '2');
  assert.deepEqual(
    channel.filters.map((f) => f.fcHz),
    [102, 1020],
  );
  send('pointerdown', inputs[0]);
  send('pointermove', inputs[0], { clientY: 95 });
  send('pointerup', inputs[0], { clientY: 95 });
  assert.deepEqual(
    channel.filters.map((f) => f.fcHz),
    [104.04, 1040.4],
  );
  assert.equal(inputs[0].value, '0');
  inputs[1].value = '8';
  send('input', inputs[1]);
  assert.deepEqual(
    channel.filters.map((f) => f.gainDb),
    [-3, 4],
  );
  send('keydown', inputs[1], { key: 'Enter' });
  assert.deepEqual(
    channel.filters.map((f) => f.gainDb),
    [5, 12],
  );
  assert.equal(inputs[1].value, '0');
  send('wheel', inputs[2], { shiftKey: true });
  assert.ok(channel.filters[0].q > 0.5 && channel.filters[0].q < 0.525);
  assert.ok(Math.abs(channel.filters[1].q / channel.filters[0].q - 10) < 0.0001);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(inputs[2].value, '0');
  assert.equal(begins, 4);
  assert.equal(ends, 4);
  inputs[0].value = '-10';
  send('input', inputs[0]);
  send('change', inputs[0]);
  assert.deepEqual(
    channel.filters.map((f) => f.fcHz),
    [93.636, 936.36],
  );
  assert.equal(inputs[0].value, '0');
  inputs[0].value = '50';
  send('input', inputs[0]);
  send('keydown', inputs[0], { key: 'Escape' });
  assert.deepEqual(
    channel.filters.map((f) => f.fcHz),
    [93.636, 936.36],
  );
  assert.equal(inputs[0].value, '0');
});
