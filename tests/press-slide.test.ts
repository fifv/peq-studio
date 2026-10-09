import test from 'node:test';
import assert from 'node:assert/strict';
import { installPressSlide } from '../src/ui/press-slide.ts';

test('press-slide survives replaced controls, groups changes and suppresses the release click', (t) => {
  class Node extends EventTarget {
    dataset: Record<string, string> = {};
    disabled = false;
    capture = false;
    closest() {
      return this;
    }
    matches() {
      return this.disabled;
    }
    contains() {
      return true;
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
  }
  const root = new Node();
  let hit = new Node();
  hit.dataset.key = '0';
  for (const [key, value] of Object.entries({
    Element: Node,
    document: { elementFromPoint: () => hit },
    window: new EventTarget(),
  })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      before
        ? Object.defineProperty(globalThis, key, before)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const changes: { key: string; group: symbol; first: boolean }[] = [];
  installPressSlide(
    root as unknown as HTMLElement,
    '[data-toggle]',
    (button) => button.dataset.key!,
    (button, group, first) => changes.push({ key: button.dataset.key!, group, first }),
  );
  function send(type: string, extra: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      target: hit,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 0,
      clientY: 0,
      ...extra,
    }))
      Object.defineProperty(event, key, { value });
    root.dispatchEvent(event);
    return event;
  }
  send('pointerdown');
  hit = new Node();
  hit.dataset.key = '0';
  send('pointermove');
  hit = new Node();
  hit.dataset.key = '1';
  send('pointermove');
  send('pointermove');
  hit = new Node();
  hit.dataset.key = '2';
  send('pointermove');
  send('pointerup');
  assert.deepEqual(
    changes.map((c) => [c.key, c.first]),
    [
      ['0', true],
      ['1', false],
      ['2', false],
    ],
  );
  assert.equal(new Set(changes.map((c) => c.group)).size, 1);
  assert.equal(root.capture, false);
  assert.equal(send('click').defaultPrevented, true);
  send('pointerdown', { pointerType: 'touch' });
  assert.equal(changes.length, 3);
});
