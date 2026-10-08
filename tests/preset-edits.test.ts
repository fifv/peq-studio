import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, newBand, newPreset, validateState } from '../src/model.ts';
import { activePreset } from '../src/utils.ts';
import { applyPresetImport, duplicateBand, moveBand } from '../src/preset-edits.ts';
import { WorkspaceHistory } from '../src/history.ts';

test('replace import preserves identity and curves, replaces both channels, and undoes as one edit', () => {
  const state = initialState();
  const current = activePreset(state);
  current.targetId = 'my-target';
  current.sourceId = 'my-source';
  const original = structuredClone(state);
  const imported = newPreset('Stereo', { preampDb: -4, filters: [newBand(100, 2)] });
  imported.linked = false;
  imported.right = { preampDb: -6, filters: [newBand(200, -3)] };
  const history = new WorkspaceHistory();
  history.capture(state);
  applyPresetImport(state, imported, 'replace');
  assert.equal(state.presets.length, original.presets.length);
  assert.equal(current.id, original.activeId);
  assert.equal(current.name, original.presets[0].name);
  assert.equal(current.targetId, 'my-target');
  assert.equal(current.sourceId, 'my-source');
  assert.equal(current.linked, false);
  assert.deepEqual(current.left, imported.left);
  assert.deepEqual(current.right, imported.right);
  assert.deepEqual(history.restore(state, true), original);
});

test('append keeps gain and bypass, preserves stereo content and does not alias imported bands', () => {
  for (const currentLinked of [true, false]) {
    for (const importedLinked of [true, false]) {
      const state = initialState();
      const current = activePreset(state);
      current.linked = currentLinked;
      current.enabled = false;
      current.left = { preampDb: -5, filters: [newBand(50)] };
      current.right = { preampDb: -8, filters: [newBand(80)] };
      const imported = newPreset('Added', { preampDb: -20, filters: [newBand(100)] });
      imported.linked = importedLinked;
      imported.right.filters = [newBand(200)];
      applyPresetImport(state, imported, 'append');
      assert.equal(current.enabled, false);
      assert.equal(current.linked, currentLinked && importedLinked);
      assert.equal(current.left.preampDb, -5);
      assert.equal(current.right.preampDb, currentLinked ? -5 : -8);
      assert.deepEqual(
        current.left.filters.map((f) => f.fcHz),
        [50, 100],
      );
      assert.deepEqual(
        current.right.filters.map((f) => f.fcHz),
        [currentLinked ? 50 : 80, importedLinked ? 100 : 200],
      );
      imported.left.filters[0].fcHz = 999;
      assert.equal(current.left.filters[1].fcHz, 100);
    }
  }
});

test('new import leaves the previous preset intact and survives workspace restore', () => {
  const state = initialState();
  const previous = structuredClone(activePreset(state));
  const imported = newPreset('New import');
  applyPresetImport(state, imported, 'new');
  assert.equal(state.presets.length, 3);
  assert.equal(state.activeId, imported.id);
  assert.deepEqual(state.presets[0], previous);
  assert.deepEqual(validateState(state), state);
});

test('reordering moves the whole filter, tracks selection in both directions, and persists with undo', () => {
  let state = initialState();
  const current = activePreset(state);
  current.left.filters = [newBand(100), { ...newBand(200), enabled: false }, newBand(300)];
  const history = new WorkspaceHistory();
  history.capture(state);
  let selected = moveBand(current.left, 0, 2, 1);
  assert.equal(selected, 0);
  assert.deepEqual(
    current.left.filters.map((f) => f.fcHz),
    [200, 300, 100],
  );
  assert.equal(current.left.filters[0].enabled, false);
  selected = moveBand(current.left, 0, 1, selected);
  assert.equal(selected, 1);
  assert.deepEqual(
    validateState(state).presets[0].left.filters.map((f) => f.fcHz),
    [300, 200, 100],
  );
  assert.equal(moveBand(current.left, 1, 1, -1), -1);
  state = history.restore(state, true)!;
  assert.deepEqual(
    activePreset(state).left.filters.map((f) => f.fcHz),
    [100, 200, 300],
  );
});

test('duplicating inserts an independent band next to the original, preserves settings, and undoes', () => {
  const state = initialState();
  const channel = activePreset(state).left;
  channel.filters = [
    newBand(100),
    { ...newBand(500, -4), type: 'LSC', enabled: false, q: 2 },
    newBand(2000),
  ];
  const before = structuredClone(state);
  const history = new WorkspaceHistory();
  history.capture(state);
  assert.equal(duplicateBand(channel, 1), 2);
  assert.deepEqual(
    channel.filters.map((f) => f.fcHz),
    [100, 500, 500, 2000],
  );
  assert.deepEqual(channel.filters[2], channel.filters[1]);
  channel.filters[2].gainDb = 3;
  assert.equal(channel.filters[1].gainDb, -4);
  assert.equal(validateState(state).presets[0].left.filters[2].gainDb, 3);
  assert.deepEqual(history.restore(state, true), before);
  assert.equal(duplicateBand(channel, 3), 4);
  assert.equal(channel.filters[4].fcHz, 2000);
});
