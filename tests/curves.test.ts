import type { CurvePoint } from '../src/types.ts';
import { activePreset } from '../src/utils.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TARGETS,
  customCurves,
  findCurve,
  searchCurves,
  removeCustomCurve,
  reorderedCustomCurves,
} from '../src/curve-library.ts';
import {
  initialState,
  parseCurve,
  curveValue,
  validateState,
  newPreset,
  exportPreset,
  importPreset,
} from '../src/model.ts';
import { WorkspaceHistory } from '../src/history.ts';
import { BUILTIN_SOURCES, loadBuiltinCurve } from '../src/curve-library.ts';
import { readFile } from 'node:fs/promises';

test('custom curve order survives reload and undo without changing any preset selection', () => {
  let state = initialState();
  state.curves = ['A', 'B', 'C', 'D'].map((name) => parseCurve('20,0\n20000,2', name));
  const original = state.curves.map((curve) => curve.id);
  state.presets.forEach((preset) => {
    preset.targetId = original[0];
    preset.sourceId = original[2];
  });
  const selections = state.presets.map(({ targetId, sourceId }) => [targetId, sourceId]);
  const history = new WorkspaceHistory();
  history.capture(state);
  state.curves = reorderedCustomCurves(state, original[0], original[2], true)!;
  state = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(
    state.curves.map((curve) => curve.name),
    ['B', 'C', 'A', 'D'],
  );
  assert.deepEqual(
    state.presets.map(({ targetId, sourceId }) => [targetId, sourceId]),
    selections,
  );
  assert.deepEqual(customCurves(state, 'target'), customCurves(state, 'source'));
  state = history.restore(state, true)!;
  assert.deepEqual(
    state.curves.map((curve) => curve.id),
    original,
  );
  state.curves = reorderedCustomCurves(state, original[3], original[0], false)!;
  assert.deepEqual(
    state.curves.map((curve) => curve.name),
    ['D', 'A', 'B', 'C'],
  );
});

test('filtered curve moves retain hidden rows and ignore invalid or unchanged positions', () => {
  const state = initialState();
  state.curves = ['Match A', 'Hidden', 'Match B', 'Last'].map((name) =>
    parseCurve('20,0\n20000,2', name),
  );
  const [a, b] = searchCurves(state.curves, 'match');
  state.curves = reorderedCustomCurves(state, b.id, a.id, false)!;
  assert.deepEqual(
    state.curves.map((curve) => curve.name),
    ['Match B', 'Match A', 'Hidden', 'Last'],
  );
  const before = structuredClone(state);
  assert.equal(reorderedCustomCurves(state, b.id, a.id, false), null);
  assert.equal(reorderedCustomCurves(state, a.id, b.id, true), null);
  assert.equal(reorderedCustomCurves(state, a.id, a.id, true), null);
  assert.equal(reorderedCustomCurves(state, 'missing', a.id, false), null);
  assert.equal(reorderedCustomCurves(state, a.id, BUILTIN_TARGETS[0].id, true), null);
  assert.deepEqual(state, before);
});

test('legacy shared selections migrate to each preset without overriding preset-specific choices', () => {
  const state = initialState();
  const legacy = {
    ...state,
    targetId: BUILTIN_TARGETS[0].id,
    sourceId: BUILTIN_SOURCES[0].id,
    presets: state.presets.map(({ targetId, sourceId, ...preset }) => preset),
  };
  const migrated = validateState(legacy);
  for (const preset of migrated.presets) {
    assert.equal(preset.targetId, legacy.targetId);
    assert.equal(preset.sourceId, legacy.sourceId);
  }
  assert.equal(Object.hasOwn(migrated, 'targetId'), false);
  const mixed = validateState({ ...legacy, presets: [state.presets[0], legacy.presets[1]] });
  assert.equal(mixed.presets[0].targetId, '');
  assert.equal(mixed.presets[0].sourceId, '');
  assert.equal(mixed.presets[1].targetId, legacy.targetId);
});

test('curve choices follow the preset through switching, reload, duplication, export and undo', () => {
  let state = initialState();
  const [first, second] = state.presets;
  first.targetId = BUILTIN_TARGETS[0].id;
  first.sourceId = BUILTIN_SOURCES[0].id;
  second.targetId = BUILTIN_SOURCES[1].id;
  second.sourceId = BUILTIN_TARGETS[1].id;
  state = validateState(JSON.parse(JSON.stringify(state)));
  for (const expected of [first, second, first]) {
    state.activeId = expected.id;
    assert.equal(findCurve(state, 'target')?.id, expected.targetId);
    assert.equal(findCurve(state, 'source')?.id, expected.sourceId);
  }
  const history = new WorkspaceHistory();
  history.capture(state);
  activePreset(state).targetId = '';
  activePreset(state).sourceId = '';
  assert.equal(state.presets[1].targetId, second.targetId);
  state = history.restore(state, true)!;
  assert.equal(findCurve(state, 'target')?.id, first.targetId);
  assert.equal(findCurve(state, 'source')?.id, first.sourceId);
  const duplicate = structuredClone(activePreset(state));
  duplicate.id = 'copy';
  state.presets.push(duplicate);
  state.activeId = duplicate.id;
  assert.equal(findCurve(state, 'target')?.id, first.targetId);
  const imported = importPreset(exportPreset(duplicate), 'Imported');
  assert.equal(imported.targetId, duplicate.targetId);
  assert.equal(imported.sourceId, duplicate.sourceId);
  assert.equal(newPreset().targetId, '');
  assert.equal(newPreset().sourceId, '');
});

test('all 13 original built-in targets contain real, ordered response data', () => {
  assert.equal(BUILTIN_TARGETS.length, 13);
  assert.equal(new Set(BUILTIN_TARGETS.map((c) => c.id)).size, 13);
  for (const curve of BUILTIN_TARGETS) {
    assert.ok(curve.points.length > 100);
    assert.ok(
      curve.points.every(
        ([hz, db], i) =>
          Number.isFinite(db) && hz >= 20 && hz <= 20000 && (!i || hz > curve.points[i - 1][0]),
      ),
    );
    assert.match(curve.sourceUrl, /^https:\/\/home\.toppingaudio\.com\//);
    assert.equal(curveValue(curve, 1000), 0);
  }
  const flat = BUILTIN_TARGETS.find((c) => c.name === 'Flat');
  assert.ok(flat);
  assert.ok(flat.points.every((p) => Math.abs(p[1] - flat.points[0][1]) < 0.001));
  assert.ok(
    BUILTIN_TARGETS.find((c) => c.name === 'Harman Target')!.points.some((p) => Math.abs(p[1]) > 1),
  );
});
test('all custom imports are shared, including older source-only and target-only imports', () => {
  const state = initialState();
  const curve = parseCurve('20,0\n1000,3\n20000,-4', 'Response.csv');
  state.curves = [
    curve,
    { ...curve, id: 'target-1', kind: 'target' },
    { ...curve, id: 'source-1', kind: 'source' },
  ];
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(
    customCurves(restored, 'target').map((c) => c.id),
    [curve.id, 'target-1', 'source-1'],
  );
  assert.deepEqual(
    customCurves(restored, 'source').map((c) => c.id),
    [curve.id, 'target-1', 'source-1'],
  );
  activePreset(restored).targetId = 'source-1';
  activePreset(restored).sourceId = 'target-1';
  assert.equal(findCurve(restored, 'target')!.id, 'source-1');
  assert.equal(findCurve(restored, 'source')!.id, 'target-1');
});
test('built-in selection survives workspace backup without duplicating catalog data', () => {
  const state = initialState();
  activePreset(state).targetId = BUILTIN_TARGETS[0].id;
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.curves.length, 0);
  assert.equal(findCurve(restored, 'target')!.name, BUILTIN_TARGETS[0].name);
  assert.equal(findCurve(restored, 'source', activePreset(state).targetId), BUILTIN_TARGETS[0]);
});
test('curve search matches accented names and measurement systems', () => {
  assert.equal(searchCurves(BUILTIN_TARGETS, 'bruel')[0].name, 'Brüel Kjaer Target');
  assert.equal(searchCurves(BUILTIN_TARGETS, 'harman kb501x').length, 2);
  assert.equal(searchCurves(BUILTIN_TARGETS, 'nonexistent').length, 0);
});
test('removing a custom curve clears both references and never deletes built-ins', () => {
  const state = initialState();
  const curve = parseCurve('20,0\n20000,2', 'Shared');
  state.curves.push(curve);
  for (const preset of state.presets) preset.targetId = preset.sourceId = curve.id;
  const before = structuredClone(state);
  assert.equal(removeCustomCurve(state, curve.id), true);
  assert.equal(state.curves.length, 0);
  for (const preset of state.presets) {
    assert.equal(preset.targetId, '');
    assert.equal(preset.sourceId, '');
  }
  assert.equal(findCurve(before, 'target')!.id, curve.id);
  activePreset(state).targetId = BUILTIN_TARGETS[0].id;
  assert.equal(removeCustomCurve(state, activePreset(state).targetId), false);
  assert.ok(findCurve(state, 'target'));
});
test('all 465 headphone responses have complete local files and searchable brand names', async () => {
  assert.equal(BUILTIN_SOURCES.length, 465);
  assert.equal(new Set(BUILTIN_SOURCES.map((c) => c.id)).size, 465);
  for (const curve of BUILTIN_SOURCES) {
    const data: { points: CurvePoint[] } = JSON.parse(
      await readFile(
        new URL(`../public/curves/sources/${curve.responseFile}`, import.meta.url),
        'utf8',
      ),
    );
    assert.equal(data.points.length, curve.pointCount);
    assert.ok(
      data.points.every(
        ([hz, db], i) =>
          Number.isFinite(db) && hz >= 20 && hz <= 20000 && (!i || hz > data.points[i - 1][0]),
      ),
    );
  }
  assert.ok(searchCurves(BUILTIN_SOURCES, 'akg k712').length >= 1);
  assert.ok(searchCurves(BUILTIN_SOURCES, 'sennheiser hd 650').length >= 1);
});
test('source responses load from local assets, retry failures, and survive selection restore', async () => {
  const source = searchCurves(BUILTIN_SOURCES, 'akg k712')[0];
  await assert.rejects(
    () => loadBuiltinCurve('source', source.id, async () => ({ ok: false })),
    /Cannot load/,
  );
  const loaded = await loadBuiltinCurve('source', source.id, async (url) => {
    assert.ok(url.startsWith('/curves/sources/'));
    const data: { points: CurvePoint[] } = JSON.parse(
      await readFile(new URL(`../public${decodeURIComponent(url)}`, import.meta.url), 'utf8'),
    );
    return { ok: true, json: async () => data };
  });
  const state = initialState();
  activePreset(state).sourceId = source.id;
  assert.ok(
    findCurve(validateState(JSON.parse(JSON.stringify(state))), 'source')!.points!.length > 100,
  );
  assert.equal(findCurve(state, 'target', source.id), loaded);
  assert.equal(
    await loadBuiltinCurve('source', source.id, () => {
      throw Error('Should be cached');
    }),
    loaded,
  );
});
test('either selector can load either built-in collection and restore crossed selections', async () => {
  const target = BUILTIN_TARGETS[1],
    source = BUILTIN_SOURCES[1];
  assert.equal(await loadBuiltinCurve('source', target.id), target);
  const state = initialState();
  activePreset(state).sourceId = target.id;
  activePreset(state).targetId = source.id;
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(findCurve(restored, 'source')!.id, target.id);
  assert.equal(findCurve(restored, 'target')!.id, source.id);
  const loaded = await loadBuiltinCurve('target', source.id, async (url) => ({
    ok: true,
    json: async () =>
      JSON.parse(
        await readFile(new URL(`../public${decodeURIComponent(url)}`, import.meta.url), 'utf8'),
      ),
  }));
  assert.ok(findCurve(restored, 'target')!.points!.length > 100);
  assert.equal(
    await loadBuiltinCurve('source', source.id, () => {
      throw Error('Should share cache');
    }),
    loaded,
  );
  assert.equal(restored.curves.length, 0);
});
