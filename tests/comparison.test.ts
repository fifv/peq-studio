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
  let filtersEnabled = true;
  const playing = () => playbackChannel(p.left, { enabled: p.enabled, filtersEnabled });
  assert.ok(Math.abs(response(playing(), 1000) - 3) < 1e-6);
  filtersEnabled = false;
  for (const hz of [20, 1000, 20000]) assert.equal(response(playing(), hz), -6);
  assert.equal(backendConfiguration(p, 48000, filtersEnabled).filtersEnabled, false);
  p.enabled = false;
  assert.equal(response(playing(), 1000), 0);
  filtersEnabled = true;
  assert.equal(response(playing(), 1000), 0);
  p.enabled = true;
  assert.ok(Math.abs(response(playing(), 1000) - 3) < 1e-6);
  assert.equal(JSON.stringify(p.left), stored);
});

test('global comparison survives backup, reload, preset switching, imports and undo', () => {
  const state = initialState();
  const history = new WorkspaceHistory();
  history.capture(state);
  state.filtersEnabled = false;
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.filtersEnabled, false);
  const imported = importPreset(exportPreset(restored.presets[0]), 'Compare');
  assert.equal('filtersEnabled' in imported, false, 'A/B mode is not part of a preset');
  applyPresetImport(state, imported, 'replace');
  assert.equal(state.filtersEnabled, false);
  state.activeId = state.presets[1].id;
  assert.equal(
    backendConfiguration(state.presets[1], state.sampleRate, state.filtersEnabled).filtersEnabled,
    false,
  );
  applyPresetImport(state, imported, 'new');
  assert.equal(state.filtersEnabled, false);
  assert.equal(history.restore(state, true)!.filtersEnabled, true);
});

test('legacy workspaces migrate the active preset A/B state and prefer an existing global choice', () => {
  const state = initialState();
  const legacy = JSON.parse(JSON.stringify(state));
  delete legacy.filtersEnabled;
  legacy.presets[0].filtersEnabled = true;
  legacy.presets[1].filtersEnabled = false;
  legacy.activeId = legacy.presets[1].id;
  assert.equal(validateState(legacy).filtersEnabled, false);
  legacy.filtersEnabled = true;
  assert.equal(validateState(legacy).filtersEnabled, true);
  delete legacy.filtersEnabled;
  delete legacy.presets[1].filtersEnabled;
  assert.equal(validateState(legacy).filtersEnabled, true);
  legacy.activeId = 'missing';
  legacy.presets[0].filtersEnabled = false;
  const migrated = validateState(legacy);
  assert.equal(migrated.filtersEnabled, false);
  assert.ok(migrated.presets.every((p) => !('filtersEnabled' in p)));
});
