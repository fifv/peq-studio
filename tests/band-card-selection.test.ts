import test from 'node:test';
import assert from 'node:assert/strict';
import { installBandCardSelection } from '../src/ui/band-card-selection.ts';

test('modified card gestures select, toggle on entry, and update ranges without firing controls', (t) => {
  class CardElement extends EventTarget {
    dataset = { bandCard: '3' };
    capture = false;
    background = false;
    closest() {
      return this.background ? null : this;
    }
    matches() {
      return this.background;
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
  const root = new CardElement();
  let hit: CardElement | null = root;
  const windowTarget = new EventTarget();
  for (const [key, value] of Object.entries({
    Element: CardElement,
    window: windowTarget,
    document: { elementFromPoint: () => hit },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const selections: unknown[] = [];
  installBandCardSelection(root as unknown as HTMLElement, (...args) => selections.push(args));
  let actions = 0;
  for (const type of ['pointerdown', 'click', 'dblclick'])
    root.addEventListener(type, () => actions++);
  function send(type: string, modifiers: Record<string, unknown>) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      button: 0,
      pointerId: 1,
      buttons: 1,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...modifiers,
    }))
      Object.defineProperty(event, key, { value });
    root.dispatchEvent(event);
    return event;
  }
  for (const modifiers of [
    { ctrlKey: true },
    { shiftKey: true },
    { metaKey: true },
    { ctrlKey: true, shiftKey: true },
  ]) {
    assert.equal(send('pointerdown', modifiers).defaultPrevented, true);
    send('pointerup', modifiers);
    assert.equal(send('click', modifiers).defaultPrevented, true);
    assert.equal(send('dblclick', modifiers).defaultPrevented, true);
  }
  assert.equal(actions, 0);
  assert.deepEqual(selections, [
    [3, true, false],
    [3, false, true],
    [3, true, false],
    [3, true, true],
  ]);
  send('pointerdown', {});
  send('click', {});
  send('click', { ctrlKey: true, button: 2 });
  assert.equal(actions, 3, 'ordinary and secondary clicks retain their normal behavior');

  selections.length = 0;
  send('pointerdown', { ctrlKey: true });
  hit = new CardElement();
  hit.dataset.bandCard = '4';
  send('pointermove', {});
  send('pointermove', {});
  hit = null;
  send('pointermove', {});
  hit = new CardElement();
  hit.dataset.bandCard = '4';
  send('pointermove', {});
  send('pointerup', {});
  assert.equal(send('click', {}).defaultPrevented, true, 'release never activates a control');
  assert.equal(root.capture, false);
  assert.deepEqual(
    selections,
    [
      [3, true, false],
      [4, true, false, undefined],
      [4, true, false, undefined],
    ],
    'Ctrl toggles once per entry, including re-entry, without toggling repeatedly within a card',
  );

  selections.length = 0;
  send('pointerdown', { shiftKey: true });
  for (const index of [6, 4, 1]) {
    hit.dataset.bandCard = String(index);
    send('pointermove', {});
  }
  send('pointercancel', {});
  hit.dataset.bandCard = '8';
  send('pointermove', {});
  assert.deepEqual(
    selections,
    [
      [3, false, true],
      [6, false, true, 3],
      [4, false, true, 3],
      [1, false, true, 3],
    ],
    'Shift ranges expand, shrink, and reverse around the gesture start',
  );
  assert.equal(root.capture, false);
  send('pointerdown', { ctrlKey: true });
  windowTarget.dispatchEvent(new Event('blur'));
  assert.equal(root.capture, false, 'losing focus ends selection');

  const background = new CardElement();
  background.background = true;
  for (const range of [false, true]) {
    selections.length = 0;
    const modifiers = { target: background, ctrlKey: !range, shiftKey: range };
    assert.equal(send('pointerdown', modifiers).defaultPrevented, true);
    assert.deepEqual(selections, [], 'starting on empty space preserves the selection');
    hit = null;
    send('pointermove', {});
    hit = new CardElement();
    for (const index of [2, 5, 3]) {
      hit.dataset.bandCard = String(index);
      send('pointermove', {});
    }
    send('pointerup', {});
    assert.equal(send('click', { target: background }).defaultPrevented, true);
    assert.deepEqual(
      selections,
      [2, 5, 3].map((index) => [index, !range, range, range ? 2 : undefined]),
      'selection begins on entry, with the first entered card anchoring a Shift range',
    );
  }
  selections.length = 0;
  send('pointerdown', { target: background, ctrlKey: true });
  send('pointerup', {});
  assert.equal(send('click', { target: background }).defaultPrevented, true);
  assert.deepEqual(selections, [], 'modified blank clicks do not clear the selection');
  assert.equal(send('pointerdown', { target: background }).defaultPrevented, false);
  assert.equal(
    send('click', { target: background }).defaultPrevented,
    false,
    'plain blank clicks still reach the existing deselect handler',
  );
});
