import type { ChartView } from './types.ts';
import { clamp } from './utils.ts';

export const CHART_MIN_HEIGHT = 220;
export const CHART_MAX_HEIGHT = 1400;
const MIN_HZ = 20;
const MAX_HZ = 20000;
const FULL_SPAN = Math.log(MAX_HZ / MIN_HZ);
const MIN_SPAN = Math.log(2) / 6;
export type FrequencyWindow = Pick<ChartView, 'minHz' | 'maxHz'>;

export const defaultChartView = (): ChartView => ({ height: null, minHz: MIN_HZ, maxHz: MAX_HZ });

/** Clamp a logarithmic window by moving it at the edges, preserving its zoom. */
function windowAt(start: number, span: number): FrequencyWindow {
  span = clamp(span, MIN_SPAN, FULL_SPAN);
  if (span === FULL_SPAN) return { minHz: MIN_HZ, maxHz: MAX_HZ };
  start = clamp(start, Math.log(MIN_HZ), Math.log(MAX_HZ) - span);
  return {
    minHz: clamp(Math.exp(start), MIN_HZ, MAX_HZ),
    maxHz: clamp(Math.exp(start + span), MIN_HZ, MAX_HZ),
  };
}
export function normalizeChartView(value: unknown): ChartView {
  const input = value && typeof value === 'object' ? (value as Partial<ChartView>) : {};
  const defaults = defaultChartView();
  const height =
    typeof input.height === 'number' && Number.isFinite(input.height)
      ? clamp(input.height, CHART_MIN_HEIGHT, CHART_MAX_HEIGHT)
      : null;
  const { minHz, maxHz } = input;
  if (
    typeof minHz !== 'number' ||
    typeof maxHz !== 'number' ||
    !Number.isFinite(minHz) ||
    !Number.isFinite(maxHz) ||
    minHz <= 0 ||
    minHz >= maxHz
  )
    return { ...defaults, height };
  if (minHz >= MIN_HZ && maxHz <= MAX_HZ && Math.log(maxHz / minHz) >= MIN_SPAN - 1e-12)
    return { height, minHz, maxHz };
  return { height, ...windowAt(Math.log(minHz), Math.log(maxHz / minHz)) };
}
export const frequencyAt = (view: FrequencyWindow, fraction: number) =>
  view.minHz * (view.maxHz / view.minHz) ** fraction;
export const frequencyPosition = (view: FrequencyWindow, hz: number) =>
  Math.log(hz / view.minHz) / Math.log(view.maxHz / view.minHz);
export function zoomFrequency(
  view: FrequencyWindow,
  factor: number,
  anchor = 0.5,
): FrequencyWindow {
  const span = clamp(Math.log(view.maxHz / view.minHz) / factor, MIN_SPAN, FULL_SPAN);
  return windowAt(Math.log(frequencyAt(view, anchor)) - span * anchor, span);
}
export function panFrequency(view: FrequencyWindow, fraction: number): FrequencyWindow {
  const span = Math.log(view.maxHz / view.minHz);
  return windowAt(Math.log(view.minHz) + fraction * span, span);
}
