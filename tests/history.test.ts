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
  state.presets[0].curveAlignment.targetOffsetDb = 2.5;
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
    state.presets[0].curveAlignment.targetOffsetDb = i;
    history.capture(state);
  }
  let restored = state;
  let count = 0;
  while (history.canUndo) {
    restored = history.restore(restored, true)!;
    count++;
  }
  assert.equal(count, 80);
  assert.equal(restored.presets[0].curveAlignment.targetOffsetDb, 10);
  assert.equal(history.restore(restored, true), null);
  history.capture(restored);
  assert.equal(history.canRedo, false);
});

test('a curve slide uses one undo entry including the final load after pointer release', async () => {
  const history = new WorkspaceHistory();
  let state = initialState();
  const before = structuredClone(state);
  const group = Symbol('slide');
  for (const id of ['curve-a', 'curve-b', 'curve-c']) {
    history.capture(state, group);
    state.presets[0].targetId = id;
  }
  await Promise.resolve();
  history.capture(state, group);
  state.presets[0].targetId = 'final-curve';
  const final = structuredClone(state);
  state = history.restore(state, true)!;
  assert.deepEqual(state, before);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.restore(state, false), final);
});

test('new curve gestures and intervening edits remain independent undo steps', () => {
  const history = new WorkspaceHistory();
  let state = initialState();
  const group = Symbol('slide');
  history.capture(state, group);
  state.presets[0].sourceId = 'first';
  history.capture(state);
  state.presets[0].curveAlignment.sourceOffsetDb = 3;
  history.capture(state, group);
  state.presets[0].sourceId = 'late-load';
  history.capture(state, Symbol('next-slide'));
  state.presets[0].sourceId = 'next';
  state = history.restore(state, true)!;
  assert.equal(state.presets[0].sourceId, 'late-load');
  state = history.restore(state, true)!;
  assert.equal(state.presets[0].sourceId, 'first');
  assert.equal(state.presets[0].curveAlignment.sourceOffsetDb, 3);
  state = history.restore(state, true)!;
  assert.equal(state.presets[0].curveAlignment.sourceOffsetDb, 0);
  assert.equal(state.presets[0].sourceId, 'first');
});
