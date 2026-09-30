import type { Channel, CurveDisplay, MeasuredCurve, Workspace } from './types.ts';
import { curveShift } from './curve-level.ts';
import { interpolate } from './curve-math.ts';
import { findCurve } from './curve-library.ts';
import { FREQUENCIES, response } from './model.ts';

/** Shared by the graph, hover readings and export so displayed levels agree. */
export function displayedCurves(
  source: MeasuredCurve | null,
  target: MeasuredCurve | null,
  display: CurveDisplay,
) {
  const targetShift = curveShift(target, 'target', display);
  const sourceShift = curveShift(source, 'source', display);
  const targetValue = (hz: number) => (target ? interpolate(target.points, hz) + targetShift : 0);
  const sourceValue = (hz: number) => (source ? interpolate(source.points, hz) + sourceShift : 0);
  const offset = (hz: number) => (display.compensated && target ? targetValue(hz) : 0);
  const filteredValue = (hz: number, combined: number, preamp: number, enabled: boolean) =>
    sourceValue(hz) + combined - (enabled && !display.includePreamp ? preamp : 0) - offset(hz);
  return { targetShift, sourceShift, targetValue, sourceValue, offset, filteredValue };
}

export function exportFilteredCurve(state: Workspace, channel: Channel, enabled: boolean): string {
  const source = findCurve(state, 'source');
  const target = findCurve(state, 'target');
  if (!source) throw Error('Choose a source curve before exporting the filtered curve.');
  if (!source.points || (state.curveDisplay.compensated && target && !target.points))
    throw Error('Curve data is still loading. Please try again.');
  const { filteredValue } = displayedCurves(
    { ...source, points: source.points },
    target?.points ? { ...target, points: target.points } : null,
    state.curveDisplay,
  );
  const rows = FREQUENCIES.map((hz) => {
    const combined = enabled ? response(channel, hz, state.sampleRate) : 0;
    const db = filteredValue(hz, combined, channel.preampDb, enabled);
    if (!Number.isFinite(db)) throw Error('The filtered curve contains an invalid amplitude.');
    return `${hz.toFixed(6)},${db.toFixed(6)}`;
  });
  return [
    '# Filtered curve — current display levels',
    `# Sample rate: ${state.sampleRate} Hz; PEQ: ${enabled ? 'on' : 'bypassed'}`,
    `# Alignment: ${state.curveDisplay.method}; preamp: ${state.curveDisplay.includePreamp ? 'included' : 'excluded'}; compensated: ${state.curveDisplay.compensated ? 'yes' : 'no'}`,
    'Frequency (Hz),Amplitude (dB)',
    ...rows,
    '',
  ].join('\n');
}
