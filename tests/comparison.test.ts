import test from 'node:test';
import assert from 'node:assert/strict';
import { backendConfiguration } from '../src/backends/index.ts';
import {
  initialState,
  newPreset,
  newBand,
  playbackChannel,
  response,
  exportPreset,
  importPreset,
  validateState,
} from '../src/model.ts';
import { WorkspaceHistory } from '../src/history.ts';
import { applyPresetImport } from '../src/preset-edits.ts';

test('preamp-only comparison keeps gains and per-band bypass through A/B and master power', () => {
  const p = newPreset('Compare', {
    preampDb: -6,
    filters: [newBand(1000, 9), { ...newBand(3000, 4), enabled: false }],
  });
  const stored = JSON.stringify(p.left);
  assert.ok(Math.abs(response(playbackChannel(p.left, p), 1000) - 3) < 1e-6);
  p.filtersEnabled = false;
  for (const hz of [20, 1000, 20000]) assert.equal(response(playbackChannel(p.left, p), hz), -6);
  assert.equal(backendConfiguration(p).filtersEnabled, false);
  p.enabled = false;
  assert.equal(response(playbackChannel(p.left, p), 1000), 0);
  p.filtersEnabled = true;
  assert.equal(response(playbackChannel(p.left, p), 1000), 0);
  p.enabled = true;
  assert.ok(Math.abs(response(playbackChannel(p.left, p), 1000) - 3) < 1e-6);
  assert.equal(JSON.stringify(p.left), stored);
});

test('comparison survives JSON, workspace reload, replace import and undo', () => {
  const state = initialState();
  const history = new WorkspaceHistory();
  history.capture(state);
  state.presets[0].filtersEnabled = false;
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.presets[0].filtersEnabled, false);
  const imported = importPreset(exportPreset(restored.presets[0]), 'Compare');
  assert.equal(imported.filtersEnabled, false);
  applyPresetImport(state, imported, 'replace');
  assert.equal(state.presets[0].filtersEnabled, false);
  assert.equal(history.restore(state, true)!.presets[0].filtersEnabled, true);
  const legacy = JSON.parse(JSON.stringify(state));
  delete legacy.presets[0].filtersEnabled;
  legacy.presets[0].enabled = false;
  const migrated = validateState(legacy).presets[0];
  assert.equal(migrated.filtersEnabled, true);
  assert.equal(migrated.enabled, false);
  assert.equal(response(playbackChannel(migrated.left, migrated), 1000), 0);
});
