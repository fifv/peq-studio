import test from 'node:test';
import assert from 'node:assert/strict';
import { installBandKeyboard } from '../src/ui/band-keyboard.ts';
import { initialState, newBand, validateState } from '../src/model.ts';
import { WorkspaceHistory } from '../src/history.ts';

test('Space inverts selected bands individually in one undo step and respects keyboard contexts', (t) => {
  class Target {
    editing = false;
    button = false;
    card = false;
    closest(selector: string) {
      return (
        selector.startsWith('input')
          ? this.editing
          : selector.startsWith('button')
            ? this.button
            : this.card
      )
        ? this
        : null;
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: Target });
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'Element', previous)
      : Reflect.deleteProperty(globalThis, 'Element'),
  );
  let modal = false;
  const root = Object.assign(new EventTarget(), { querySelector: () => (modal ? {} : null) });
  const target = new Target();
  let state = initialState();
  state.presets[0].left.filters = [newBand(100, 1), newBand(1000, 2), newBand(5000, 3)];
  state.presets[0].left.filters[1].enabled = false;
  const history = new WorkspaceHistory();
  let selection = [0, 1];
  let commits = 0;
  let saved = '';
  let comparisons = 0;
  const filters = () => state.presets[0].left.filters;
  installBandKeyboard(
    root as unknown as Document,
    () => selection.map((i) => filters()[i]),
    (change) => {
      history.capture(state);
      change();
      saved = JSON.stringify(state);
      commits++;
    },
    () => {
      state.filtersEnabled = !state.filtersEnabled;
      saved = JSON.stringify(state);
      comparisons++;
    },
  );
  function press(props: Record<string, unknown> = {}) {
    const event = new Event('keydown', { cancelable: true });
    for (const [key, value] of Object.entries({ key: ' ', target, ...props }))
      Object.defineProperty(event, key, { value });
    root.dispatchEvent(event);
    return event.defaultPrevented;
  }
  target.button = target.card = true;
  assert.equal(press(), true, 'Space suppresses native card-button activation and page scroll');
  assert.deepEqual(
    filters().map((f) => f.enabled),
    [false, true, true],
  );
  assert.deepEqual(
    validateState(JSON.parse(saved)).presets[0].left.filters.map((f) => f.enabled),
    [false, true, true],
  );
  assert.equal(press({ repeat: true }), true);
  assert.equal(commits, 1, 'holding Space does not repeatedly toggle');
  assert.equal(comparisons, 0, 'band selection never toggles the global comparison');
  state = history.restore(state, true)!;
  assert.deepEqual(
    filters().map((f) => f.enabled),
    [true, false, true],
  );
  selection = [1];
  press();
  assert.deepEqual(
    filters().map((f) => f.enabled),
    [true, true, true],
  );
  const before = commits;
  for (const modifier of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'isComposing'])
    assert.equal(press({ [modifier]: true }), false);
  target.editing = true;
  assert.equal(press(), false, 'typing and popup controls keep Space');
  target.editing = false;
  target.card = false;
  assert.equal(press(), false, 'unrelated buttons keep their native action');
  target.button = false;
  modal = true;
  assert.equal(press(), false);
  modal = false;
  selection = [];
  assert.equal(comparisons, 0, 'typing, modifiers, and dialogs never toggle comparison');
  const beforeFilters = structuredClone(filters());
  assert.equal(press(), true, 'no selection toggles preamp-only instead of page scrolling');
  assert.equal(state.filtersEnabled, false);
  assert.equal(validateState(JSON.parse(saved)).filtersEnabled, false);
  assert.equal(press({ repeat: true }), true);
  assert.equal(comparisons, 1);
  assert.equal(press(), true);
  assert.equal(state.filtersEnabled, true);
  assert.equal(comparisons, 2);
  assert.deepEqual(filters(), beforeFilters, 'comparison preserves individual band states');
  assert.equal(commits, before);
});
