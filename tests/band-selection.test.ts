import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustBands, stepBands, pointsInRectangle, bandRange } from '../src/band-selection.ts';
import { initialState, newBand, validateState } from '../src/model.ts';
import { WorkspaceHistory } from '../src/history.ts';

test('Shift-click range includes both endpoints in card order, even backwards', () => {
  assert.deepEqual(bandRange(2, 5), [2, 3, 4, 5]);
  assert.deepEqual(bandRange(5, 2), [2, 3, 4, 5]);
  assert.deepEqual(bandRange(2, 2), [2]);
});

test('rectangle selection includes boundaries and works in every drag direction', () => {
  const points = [
    { index: 0, point: { x: 10, y: 20 } },
    { index: 1, point: { x: 50, y: 60 } },
    { index: 2, point: { x: 70, y: 40 } },
  ];
  for (const [start, end] of [
    [
      { x: 10, y: 20 },
      { x: 50, y: 60 },
    ],
    [
      { x: 50, y: 60 },
      { x: 10, y: 20 },
    ],
    [
      { x: 10, y: 60 },
      { x: 50, y: 20 },
    ],
  ])
    assert.deepEqual(pointsInRectangle(points, start, end), [0, 1]);
  assert.deepEqual(pointsInRectangle(points, { x: 80, y: 80 }, { x: 90, y: 90 }), []);
});

test('relative group changes preserve frequency and Q ratios, gain differences and bypass states', () => {
  const filters = [newBand(100, -3), newBand(1000, 4)];
  filters[0].q = 0.5;
  filters[1].q = 5;
  filters[1].enabled = false;
  stepBands(filters, 'fcHz', 5);
  stepBands(filters, 'q', 1);
  stepBands(filters, 'gainDb', 1);
  assert.ok(Math.abs(filters[1].fcHz / filters[0].fcHz - 10) < 0.00001);
  assert.equal(filters[1].q / filters[0].q, 10);
  assert.equal(filters[1].gainDb - filters[0].gainDb, 7);
  assert.equal(filters[1].enabled, false);
  stepBands(filters, 'gainDb', 0.1);
  assert.equal(filters[0].gainDb, -2.89);
  stepBands(filters, 'q', -1);
  assert.equal(filters[0].q, 0.5);
});

test('group limits stop the whole ratio change and pass filters keep their gain', () => {
  const filters = [newBand(100, 2), newBand(10000, 3)];
  adjustBands(filters, 'fcHz', 10);
  assert.deepEqual(
    filters.map((f) => f.fcHz),
    [200, 20000],
  );
  adjustBands(filters, 'fcHz', 0.001);
  assert.deepEqual(
    filters.map((f) => f.fcHz),
    [20, 2000],
  );
  filters[0].q = 1;
  filters[1].q = 10;
  adjustBands(filters, 'q', 10);
  assert.deepEqual(
    filters.map((f) => f.q),
    [2, 20],
  );
  adjustBands(filters, 'q', 0.001);
  assert.deepEqual(
    filters.map((f) => f.q),
    [0.1, 1],
  );
  filters[1].type = 'HP';
  adjustBands(filters, 'gainDb', 2);
  assert.deepEqual(
    filters.map((f) => f.gainDb),
    [4, 3],
  );
});

test('group edit is one undo step and edited values survive reload', () => {
  const state = initialState();
  const filters = state.presets[0].left.filters;
  const before = structuredClone(filters);
  const history = new WorkspaceHistory();
  history.capture(state);
  stepBands(filters, 'gainDb', 5);
  filters.forEach((f) => {
    f.enabled = false;
  });
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.presets[0].left.filters, filters);
  const undone = history.restore(state, true)!;
  assert.deepEqual(undone.presets[0].left.filters, before);
  assert.deepEqual(history.restore(undone, false)!.presets[0].left.filters, filters);
});
