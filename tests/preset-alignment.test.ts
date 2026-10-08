import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  validateState,
  newPreset,
  exportPreset,
  importPreset,
} from '../src/model.ts';
import { defaultCurveAlignment, defaultCurveDisplay, getCurveDisplay } from '../src/curve-level.ts';
import { WorkspaceHistory } from '../src/history.ts';

test('legacy global offsets and alignment migrate independently into every preset', () => {
  const legacy = JSON.parse(JSON.stringify(initialState()));
  for (const preset of legacy.presets) delete preset.curveAlignment;
  legacy.curveDisplay = {
    ...defaultCurveDisplay(),
    method: '1k',
    sourceOffsetDb: -3,
    targetOffsetDb: 2,
    referenceDb: 12,
    minHz: 200,
    maxHz: 6000,
  };
  const migrated = validateState(legacy);
  assert.deepEqual(migrated.presets[0].curveAlignment, migrated.presets[1].curveAlignment);
  assert.equal(getCurveDisplay(migrated).sourceOffsetDb, -3);
  migrated.presets[0].curveAlignment.sourceOffsetDb = 5;
  assert.equal(migrated.presets[1].curveAlignment.sourceOffsetDb, -3);
  legacy.presets[1].curveAlignment = defaultCurveAlignment();
  assert.equal(validateState(legacy).presets[1].curveAlignment.sourceOffsetDb, 0);
});
test('preset alignment follows switching, reload, duplication, JSON export, and undo', () => {
  let state = initialState();
  const first = state.presets[0];
  first.curveAlignment = {
    method: 'band-energy',
    minHz: 300,
    maxHz: 8000,
    referenceDb: 3,
    sourceOffsetDb: -4,
    targetOffsetDb: 2,
  };
  assert.equal(getCurveDisplay(state).method, 'band-energy');
  state.activeId = state.presets[1].id;
  assert.deepEqual(getCurveDisplay(state), defaultCurveDisplay());
  state = validateState(JSON.parse(JSON.stringify(state)));
  state.activeId = first.id;
  assert.equal(getCurveDisplay(state).sourceOffsetDb, -4);
  const copy = structuredClone(first);
  copy.curveAlignment.sourceOffsetDb = 7;
  assert.equal(first.curveAlignment.sourceOffsetDb, -4);
  assert.deepEqual(
    importPreset(exportPreset(first), 'Imported').curveAlignment,
    first.curveAlignment,
  );
  assert.deepEqual(newPreset().curveAlignment, defaultCurveAlignment());
  const history = new WorkspaceHistory();
  history.capture(state);
  state.presets[0].curveAlignment.method = 'none';
  const undone = history.restore(state, true)!;
  assert.equal(getCurveDisplay(undone).method, 'band-energy');
  assert.equal(getCurveDisplay(history.restore(undone, false)!).method, 'none');
});
