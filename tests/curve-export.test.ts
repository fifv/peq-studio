import test from 'node:test';
import assert from 'node:assert/strict';
import { exportFilteredCurve } from '../src/curve-export.ts';
import { FREQUENCIES, initialState, newBand, parseCurve } from '../src/model.ts';
import { activePreset } from '../src/utils.ts';
import { BUILTIN_SOURCES } from '../src/curve-library.ts';

function setup() {
  const state = initialState();
  const source = parseCurve('20,80\n20000,80', 'Source');
  const target = parseCurve('20,70\n20000,70', 'Target');
  state.curves.push(source, target);
  const preset = activePreset(state);
  preset.sourceId = source.id;
  preset.targetId = target.id;
  preset.curveAlignment.method = 'none';
  preset.left = {
    preampDb: -3,
    filters: [newBand(FREQUENCIES[100], 6), { ...newBand(1000, 12), enabled: false }],
  };
  return { state, preset };
}

test('filtered CSV round trips with 512 points and respects filters, sample rate, preamp and bypass', () => {
  const { state, preset } = setup();
  const exported = (enabled = true) =>
    parseCurve(exportFilteredCurve(state, preset.left, enabled), 'Filtered');
  for (const sampleRate of [44100, 48000, 96000]) {
    state.sampleRate = sampleRate;
    state.curveDisplay.includePreamp = false;
    const curve = exported();
    assert.equal(curve.points.length, 512);
    assert.equal(curve.points[0][0], 20);
    assert.equal(curve.points.at(-1)![0], 20000);
    assert.ok(Math.abs(curve.points[100][1] - 86) < 0.00001);
    state.curveDisplay.includePreamp = true;
    assert.ok(Math.abs(exported().points[100][1] - 83) < 0.00001);
    assert.ok(exported(false).points.every(([, db]) => db === 80));
  }
});

test('export follows alignment, independent offsets and target compensation', () => {
  const { state, preset } = setup();
  preset.left.filters = [];
  preset.curveAlignment.method = 'band-average';
  preset.curveAlignment.referenceDb = 75;
  preset.curveAlignment.sourceOffsetDb = 3;
  preset.curveAlignment.targetOffsetDb = 2;
  const values = () =>
    parseCurve(exportFilteredCurve(state, preset.left, true), 'Filtered').points.map(
      ([, db]) => db,
    );
  assert.ok(values().every((db) => db === 78));
  state.curveDisplay.compensated = true;
  assert.ok(values().every((db) => db === 1));
  preset.curveAlignment.method = 'none';
  assert.ok(values().every((db) => db === 11));
});

test('export rejects absent or unloaded source data instead of exporting a fabricated response', () => {
  const { state, preset } = setup();
  preset.sourceId = '';
  assert.throws(() => exportFilteredCurve(state, preset.left, true), /Choose a source curve/);
  preset.sourceId = BUILTIN_SOURCES[0].id;
  assert.throws(() => exportFilteredCurve(state, preset.left, true), /still loading/);
});

test('filtered exports match preamp-only comparison and the display preamp preference', () => {
  const { state, preset } = setup();
  const values = (enabled = true) =>
    parseCurve(exportFilteredCurve(state, preset.left, enabled, false), 'Comparison').points.map(
      ([, db]) => db,
    );
  state.curveDisplay.includePreamp = true;
  assert.ok(values().every((db) => db === 77));
  state.curveDisplay.includePreamp = false;
  assert.ok(values().every((db) => db === 80));
  assert.ok(values(false).every((db) => db === 80));
});
