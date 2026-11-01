import test from 'node:test';
import assert from 'node:assert/strict';
import { installCurveSlide } from '../src/ui/curve-slide.ts';

test('curve slide starts in list gaps without selecting, groups entered rows, and preserves other controls', (t) => {
  class Node extends EventTarget {
    dataset: Record<string, string> = {};
    capture = false;
    clientLeft = 0;
    clientTop = 0;
    clientWidth = 180;
    clientHeight = 300;
    scrollTop = 0;
    classList = { add() {}, remove() {} };
    closest(selector: string) {
      return (selector === '.curve-choice' ? this.dataset.curveId : this.dataset.view)
        ? this
        : null;
    }
    contains() {
      return true;
    }
    querySelector(selector: string): Node | null {
      return selector === '.curve-list' ? list : null;
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
  const root = new Node(),
    list = new Node();
  let hit = list;
  for (const [key, value] of Object.entries({
    Element: Node,
    document: { elementFromPoint: () => hit },
    window: new EventTarget(),
    cancelAnimationFrame: () => {},
    requestAnimationFrame: (): number => 1,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const changes: { id: string; group: symbol | undefined }[] = [],
    collections: string[] = [];
  const slide = installCurveSlide(
    root as unknown as HTMLElement,
    (id) => changes.push({ id, group: slide.group }),
    (id) => collections.push(id),
  );
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
    return event.defaultPrevented;
  }
  assert.equal(send('pointerdown'), true);
  assert.equal(slide.active, true);
  assert.equal(changes.length, 0);
  send('pointerup');
  assert.equal(changes.length, 0, 'clicking a gap leaves the current curve untouched');
  assert.equal(slide.active, false);
  send('pointerdown');
  hit = new Node();
  hit.dataset.curveId = 'one';
  send('pointermove');
  send('pointermove');
  hit = new Node();
  hit.dataset.curveId = 'two';
  send('pointermove');
  hit = list;
  send('pointermove');
  send('pointerup');
  assert.deepEqual(
    changes.map((c) => c.id),
    ['one', 'two'],
  );
  assert.equal(new Set(changes.map((c) => c.group)).size, 1, 'one gesture remains one undo group');
  assert.equal(root.capture, false);
  assert.equal(send('click'), true, 'release in a gap does not activate a different control');
  for (const extra of [
    { pointerType: 'touch' },
    { button: 2 },
    { clientX: 190 },
    { target: new Node() },
  ]) {
    assert.equal(send('pointerdown', extra), false);
    assert.equal(
      slide.active,
      false,
      'scrollbars, grips, buttons and touch keep their original behavior',
    );
  }
  hit = new Node();
  hit.dataset.view = 'library';
  send('pointerdown');
  hit = new Node();
  hit.dataset.view = 'custom';
  send('pointermove');
  send('pointercancel');
  assert.deepEqual(collections, ['library', 'custom']);
  hit = list;
  send('pointerdown');
  slide.dispose();
  hit = new Node();
  hit.dataset.curveId = 'three';
  send('pointermove');
  assert.equal(changes.length, 2, 'closing the menu ends gap-started gestures');
  assert.equal(root.capture, false);
});
