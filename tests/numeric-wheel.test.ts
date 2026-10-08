import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustedWheelValue,
  installNumericControls,
  qAdjustment,
} from '../src/numeric-controls.ts';
import type { NumericSpec } from '../src/types.ts';

test('wheel controls apply Alt acceleration with fine adjustment, limits and grouped undo', async (t) => {
  const documentTarget = new EventTarget();
  class Control extends EventTarget {
    closest() {
      return this;
    }
    matches() {
      return false;
    }
  }
  const original = ['document', 'window', 'Element'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: documentTarget },
    window: { configurable: true, value: new EventTarget() },
    Element: { configurable: true, value: Control },
  });
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const element = new Control();
  const spec: NumericSpec = {
    key: 'value',
    element: element as unknown as HTMLElement,
    value: 0,
    resetValue: 0,
    min: -120,
    max: 120,
    step: 0.1,
  };
  let begins = 0,
    ends = 0,
    changes = 0;
  installNumericControls({
    getControl: () => spec,
    onBegin: () => {
      begins++;
    },
    onChange: (_, value) => {
      spec.value = value;
      changes++;
    },
    onEnd: () => {
      ends++;
    },
  });
  function scroll(deltaY: number, altKey = false, shiftKey = false) {
    const event = new Event('wheel', { cancelable: true });
    Object.defineProperties(event, {
      target: { value: element },
      deltaY: { value: deltaY },
      altKey: { value: altKey },
      shiftKey: { value: shiftKey },
    });
    documentTarget.dispatchEvent(event);
    assert.equal(event.defaultPrevented, deltaY !== 0);
  }
  scroll(-100);
  assert.equal(spec.value, 0.1);
  scroll(-100, true);
  assert.equal(spec.value, 0.6);
  scroll(100, true);
  assert.equal(spec.value, 0.1);
  scroll(-100, true, true);
  assert.equal(spec.value, 0.15);
  scroll(-100, false, true);
  assert.equal(spec.value, 0.16);

  Object.assign(spec, { value: 1, ...qAdjustment });
  scroll(-100, true);
  assert.equal(spec.value, 1.27628);
  spec.value = 19.9;
  scroll(-100, true);
  assert.equal(spec.value, 20);
  spec.value = 0.11;
  scroll(100, true);
  assert.equal(spec.value, 0.1);

  Object.assign(spec, {
    value: 1000,
    step: 1,
    min: 20,
    max: 20000,
    log: true,
    wheelRatio: undefined,
    precision: undefined,
  });
  scroll(-100, true);
  assert.equal(spec.value, Math.round(1000 * 1.02 ** 5));
  spec.value = 19999;
  scroll(-100, true);
  assert.equal(spec.value, 20000);
  const before = changes;
  scroll(0, true);
  assert.equal(changes, before);
  assert.equal(begins, 1);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(ends, 1);
});

test('Q uses proportional wheel steps across its range with reciprocal down steps and fine control', () => {
  const up = { deltaY: -100, altKey: false, shiftKey: false };
  for (const start of [0.1, 0.2, 1, 10]) {
    const increased = adjustedWheelValue(start, up, qAdjustment);
    assert.ok(Math.abs(increased - start * 1.05) < 0.00001);
    const decreased = adjustedWheelValue(increased, { ...up, deltaY: 100 }, qAdjustment);
    assert.ok(Math.abs(decreased - start) < 0.00001);
    const fine = adjustedWheelValue(start, { ...up, shiftKey: true }, qAdjustment);
    assert.ok(fine > start && fine < increased, 'fine control must move even at minimum Q');
    const fast = adjustedWheelValue(start, { ...up, altKey: true }, qAdjustment);
    assert.ok(Math.abs(fast - start * 1.05 ** 5) < 0.00001);
    const fastFine = adjustedWheelValue(
      start,
      { ...up, altKey: true, shiftKey: true },
      qAdjustment,
    );
    assert.ok(fastFine > fine && fastFine < increased);
  }
  assert.equal(adjustedWheelValue(20, up, qAdjustment), 20);
  assert.equal(adjustedWheelValue(0.1, { ...up, deltaY: 100 }, qAdjustment), 0.1);
  assert.equal(adjustedWheelValue(1, { ...up, deltaY: 0 }, qAdjustment), 1);
});
