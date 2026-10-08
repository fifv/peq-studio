import type { MeasuredCurve, CurveDisplay } from '../src/types.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustedValue } from '../src/numeric-controls.ts';
import {
  bandColor,
  initialState,
  validateState,
  newBand,
  newPreset,
  importPreset,
  exportPreset,
  exportText,
  response,
} from '../src/model.ts';
import {
  curveReferenceLevel,
  curveShift,
  defaultCurveDisplay,
  defaultGraphDisplay,
  getCurveDisplay,
  normalizeCurveDisplay,
} from '../src/curve-level.ts';
const near = (a: number, b: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const flat = (db: number): Pick<MeasuredCurve, 'points'> => ({
  points: [
    [20, db],
    [20000, db],
  ],
});
test('APO preview can omit preamp while default text and JSON exports retain original gains', () => {
  const preset = newPreset('Export', { preampDb: -6, filters: [newBand(100, 3)] });
  preset.linked = false;
  preset.right.preampDb = -9;
  const original = structuredClone(preset);
  assert.match(exportText(preset.left), /^Preamp: -6\.0 dB/m);
  assert.doesNotMatch(exportText(preset.left, false), /Preamp:/);
  assert.match(exportText(preset.left, false), /Filter 1: ON PK/);
  const withPreamp = importPreset(exportPreset(preset), 'With preamp');
  assert.equal(withPreamp.left.preampDb, -6);
  assert.equal(withPreamp.right.preampDb, -9);
  assert.match(exportText(preset.left), /^Preamp: -6\.0 dB/m);
  assert.deepEqual(preset, original);
});
test('gains beyond the old limits survive gestures, persistence and both export formats', () => {
  for (const gain of [-72, -24, 24, 72]) {
    const preset = newPreset('Extended gain', { preampDb: -80, filters: [newBand(1000, gain)] });
    near(response(preset.left, 1000), gain - 80, 1e-5);
    assert.equal(importPreset(exportPreset(preset), 'JSON').left.filters[0].gainDb, gain);
    assert.equal(importPreset(exportText(preset.left), 'TXT').left.preampDb, -80);
    const state = initialState();
    state.presets.push(preset);
    assert.doesNotThrow(() => validateState(JSON.parse(JSON.stringify(state))));
  }
  near(adjustedValue(12, 10, { min: -Infinity, max: Infinity, step: 0.1 }), 13);
});
test('broadband energy level is shift invariant and matches requested reference', () => {
  const settings = { ...defaultCurveDisplay(), method: 'band-energy' as const };
  settings.referenceDb = 75;
  settings.sourceOffsetDb = -2.5;
  near(curveReferenceLevel(flat(83), settings), 83);
  near(83 + curveShift(flat(83), 'source', settings), 72.5);
  const curve: Pick<MeasuredCurve, 'points'> = {
    points: [
      [20, 10],
      [100, 20],
      [1000, 17],
      [10000, 12],
      [20000, 0],
    ],
  };
  const shifted: Pick<MeasuredCurve, 'points'> = {
    points: curve.points.map(([hz, db]) => [hz, db + 24]),
  };
  near(curveReferenceLevel(shifted, settings) - curveReferenceLevel(curve, settings), 24);
});
test('broadband energy averages power rather than one frequency or arithmetic dB', () => {
  const curve: Pick<MeasuredCurve, 'points'> = {
    points: [
      [100, 0],
      [10000, 20],
    ],
  };
  const settings = {
    ...defaultCurveDisplay(),
    method: 'band-energy' as const,
    minHz: 100,
    maxHz: 10000,
  };
  const analytic = 10 * Math.log10((100 - 1) / (2 * Math.log(10)));
  near(curveReferenceLevel(curve, settings), analytic, 0.001);
  near(curveReferenceLevel(curve, { ...settings, method: 'band-average' }), 10);
  near(curveReferenceLevel(curve, { ...settings, method: '1k' }), 10);
  assert.ok(curveReferenceLevel(curve, settings) > 13);
});
test('manual offsets apply independently after alignment and in original-level mode', () => {
  const settings = { ...defaultCurveDisplay(), targetOffsetDb: 3, sourceOffsetDb: -4 };
  near(80 + curveShift(flat(80), 'target', settings), 3);
  near(80 + curveShift(flat(80), 'source', settings), -4);
  near(curveShift(flat(80), 'source', { ...settings, method: 'none' }), -4);
});
test('curve display settings persist and old backups migrate safely', () => {
  const state = initialState();
  assert.equal(state.presets[0].curveAlignment.method, 'band-average');
  assert.equal(state.curveDisplay.includePreamp, false);
  state.presets[0].curveAlignment.method = 'band-energy';
  state.presets[0].curveAlignment.referenceDb = 75;
  state.presets[0].curveAlignment.sourceOffsetDb = -2;
  assert.deepEqual(
    getCurveDisplay(validateState(JSON.parse(JSON.stringify(state)))),
    getCurveDisplay(state),
  );
  const { curveDisplay: _removed, ...legacy } = state;
  assert.deepEqual(validateState(legacy).curveDisplay, defaultGraphDisplay());
  const repaired = normalizeCurveDisplay({
    method: 'bad',
    minHz: 12000,
    maxHz: 100,
    targetOffsetDb: Infinity,
  });
  assert.equal(repaired.method, 'band-average');
  assert.equal(repaired.minHz, 100);
  assert.equal(repaired.targetOffsetDb, 0);
});
test('filtered-curve preamp switch defaults off and preserves an explicit on', () => {
  const state = initialState();
  delete (state.curveDisplay as Partial<CurveDisplay>).includePreamp;
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).curveDisplay.includePreamp, false);
  state.curveDisplay.includePreamp = true;
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).curveDisplay.includePreamp, true);
});
test('graph zoom survives workspace reload and older workspaces retain the default range', () => {
  const state = initialState();
  state.curveDisplay.rangeDb = 10;
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).curveDisplay.rangeDb, 10);
  delete (state.curveDisplay as Partial<CurveDisplay>).rangeDb;
  assert.equal(validateState(state).curveDisplay.rangeDb, 25);
  assert.equal(normalizeCurveDisplay({ rangeDb: NaN }).rangeDb, 25);
  assert.equal(normalizeCurveDisplay({ rangeDb: -5 }).rangeDb, 5);
});
test('drag/wheel adjustment clamps correctly and frequency uses proportional increments', () => {
  near(adjustedValue(-5, 2, { min: -24, max: 12, step: 0.1 }), -4.8);
  near(adjustedValue(11.9, 10, { min: -24, max: 12, step: 0.1 }), 12);
  near(adjustedValue(1000, 1, { min: 20, max: 20000, step: 1, log: true }), 1020);
  near(adjustedValue(20000, 1, { min: 20, max: 20000, step: 1, log: true }), 20000);
  assert.ok(adjustedValue(1000, 0.1, { min: 20, max: 20000, step: 1, log: true }) < 1020);
  assert.ok(
    Array.from({ length: 128 }, (_, i) => bandColor(i)).every(
      (color) => typeof color === 'string' && color !== 'undefined',
    ),
  );
});
