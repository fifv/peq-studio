import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceHistory } from '../src/history.ts';
import { initialState } from '../src/model.ts';

test('undo restores independent snapshots and redo restores the changed workspace', () => {
  const history = new WorkspaceHistory();
  const state = initialState();
  const before = structuredClone(state);
  history.capture(state);
  state.presets[0].left.filters = [];
  state.curveDisplay.targetOffsetDb = 2.5;
  const restored = history.restore(state, true);
  assert.deepEqual(restored, before);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.restore(restored!, false), state);
});

test('new edits discard redo and undo history retains the latest 80 changes', () => {
  const history = new WorkspaceHistory();
  const state = initialState();
  for (let i = 0; i < 90; i++) {
    state.curveDisplay.targetOffsetDb = i;
    history.capture(state);
  }
  let restored = state;
  let count = 0;
  while (history.canUndo) {
    restored = history.restore(restored, true)!;
    count++;
  }
  assert.equal(count, 80);
  assert.equal(restored.curveDisplay.targetOffsetDb, 10);
  assert.equal(history.restore(restored, true), null);
  history.capture(restored);
  assert.equal(history.canRedo, false);
});
