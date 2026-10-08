import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultChartView,
  normalizeChartView,
  frequencyAt,
  frequencyPosition,
  zoomFrequency,
  panFrequency,
} from '../src/chart-view.ts';
import { initialState, validateState } from '../src/model.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≈ ${b}`);
test('horizontal zoom anchors the pointed frequency and pan stays inside the audible range', () => {
  const full = defaultChartView();
  const zoomed = zoomFrequency(full, 4, 0.3);
  near(frequencyAt(zoomed, 0.3), frequencyAt(full, 0.3));
  near(frequencyPosition(zoomed, frequencyAt(zoomed, 0.8)), 0.8);
  const left = panFrequency(zoomed, -100);
  const right = panFrequency(zoomed, 100);
  near(left.minHz, 20);
  near(right.maxHz, 20000);
  near(left.maxHz / left.minHz, zoomed.maxHz / zoomed.minHz);
  near(right.maxHz / right.minHz, zoomed.maxHz / zoomed.minHz);
  const reset = zoomFrequency(zoomed, 0.00001);
  near(reset.minHz, 20);
  near(reset.maxHz, 20000);
  const closest = zoomFrequency(zoomed, 1e9);
  near(closest.maxHz / closest.minHz, 2 ** (1 / 6));
});
test('chart height and horizontal window survive reload, with safe legacy and invalid defaults', () => {
  const state = initialState();
  state.chartView = { height: 650, ...zoomFrequency(defaultChartView(), 3) };
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  near(restored.chartView.minHz, state.chartView.minHz);
  near(restored.chartView.maxHz, state.chartView.maxHz);
  assert.equal(restored.chartView.height, 650);
  const { chartView: _old, ...legacy } = state;
  assert.deepEqual(validateState(legacy).chartView, defaultChartView());
  assert.deepEqual(
    normalizeChartView({ height: NaN, minHz: -1, maxHz: Infinity }),
    defaultChartView(),
  );
  assert.equal(normalizeChartView({ height: 1 }).height, 220);
  assert.equal(normalizeChartView({ height: 1e6 }).height, 1400);
});
