import test from 'node:test';
import assert from 'node:assert/strict';
import { installPresetSlide } from '../src/ui/preset-slide.ts';

test('preset slide can start in gaps, keeps the last selection, and leaves other gestures alone', (t) => {
  class Node extends EventTarget {
    dataset: Record<string, string> = {};
    capture = false;
    inside = true;
    clientLeft = 0;
    clientTop = 0;
    clientWidth = 180;
    clientHeight = 300;
    scrollLeft = 0;
    scrollTop = 0;
    classList = { add() {}, remove() {} };
    closest(selector: string) {
      return (selector.startsWith('.preset-select') ? this.dataset.id : this.dataset.presetId)
        ? this
        : null;
    }
    contains(node: Node) {
      return node.inside;
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 200, bottom: 300 };
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
  let hit = root;
  const windowTarget = new EventTarget();
  for (const [key, value] of Object.entries({
    Element: Node,
    document: { elementFromPoint: () => hit },
    window: windowTarget,
    getComputedStyle: (): { display: string } => ({ display: 'block' }),
    cancelAnimationFrame: () => {},
    requestAnimationFrame: (): number => 1,
  })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      before
        ? Object.defineProperty(globalThis, key, before)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const selected: string[] = [];
  installPresetSlide(root as unknown as HTMLElement, (id) => selected.push(id));
  function send(type: string, extra: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      target: hit,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 100,
      clientY: 100,
      ...extra,
    }))
      Object.defineProperty(event, key, { value });
    root.dispatchEvent(event);
    return event;
  }
  assert.equal(send('pointerdown').defaultPrevented, true);
  assert.equal(root.capture, true);
  send('pointerup');
  assert.deepEqual(selected, [], 'a gap click does not change selection');
  send('pointerdown');
  hit = new Node();
  hit.dataset = { id: 'one', presetId: 'one' };
  send('pointermove');
  send('pointermove');
  hit = new Node();
  hit.dataset = { id: 'two', presetId: 'two' };
  send('pointermove');
  hit = root;
  send('pointermove');
  send('pointerup');
  assert.deepEqual(selected, ['one', 'two'], 'entering rows selects once; gaps keep the last row');
  assert.equal(root.capture, false);
  assert.equal(send('click').defaultPrevented, true, 'release cannot trigger a second selection');
  for (const extra of [
    { pointerType: 'touch' },
    { button: 2 },
    { clientX: 190 },
    { target: new Node() },
  ]) {
    assert.equal(send('pointerdown', extra).defaultPrevented, false);
    assert.equal(
      root.capture,
      false,
      'touch, right click, scrollbar, and row action controls stay independent',
    );
  }
  hit = new Node();
  hit.dataset = { id: 'three', presetId: 'three' };
  send('pointerdown');
  assert.equal(selected.at(-1), 'three', 'pressing a row still selects immediately');
  send('pointercancel');
  hit = new Node();
  hit.dataset = { id: 'four', presetId: 'four' };
  send('pointermove');
  assert.equal(selected.at(-1), 'three', 'cancel ends the gesture');
  assert.equal(root.capture, false);
});
