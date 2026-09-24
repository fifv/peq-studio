import type { CurveDisplay, CurveRole, MeasuredCurve } from './types.ts';
import { interpolate } from './curve-math.ts';

export const LEVEL_METHODS = {
  'band-energy': 'Broadband energy match',
  'band-average': 'Broadband average (dB)',
  '1k': 'Align at 1 kHz',
  none: 'Original levels',
};
export const defaultCurveDisplay = (): CurveDisplay => ({
  method: 'band-energy',
  referenceDb: 0,
  minHz: 100,
  maxHz: 10000,
  targetOffsetDb: 0,
  sourceOffsetDb: 0,
  compensated: false,
  includePreamp: true,
  rangeDb: 25,
});
export function normalizeCurveDisplay(value: unknown = {}) {
  const settings = {
    ...defaultCurveDisplay(),
    ...(value && typeof value === 'object' ? value : {}),
  } as CurveDisplay;
  if (!Object.hasOwn(LEVEL_METHODS, settings.method)) settings.method = 'band-energy';
  for (const [key, min, max] of [
    ['referenceDb', -60, 120],
    ['targetOffsetDb', -120, 120],
    ['sourceOffsetDb', -120, 120],
    ['minHz', 20, 19999],
    ['maxHz', 21, 20000],
  ] as const) {
    if (!Number.isFinite(settings[key])) settings[key] = defaultCurveDisplay()[key];
    settings[key] = Math.min(max, Math.max(min, settings[key]));
  }
  if (settings.minHz >= settings.maxHz) {
    settings.minHz = 100;
    settings.maxHz = 10000;
  }
  settings.compensated = !!settings.compensated;
  settings.includePreamp = settings.includePreamp !== false;
  settings.rangeDb = Number.isFinite(settings.rangeDb) ? Math.max(5, settings.rangeDb) : 25;
  return settings;
}
const levelCache = new WeakMap<object, Map<string, number>>();
/** Equal log-frequency sampling models equal input energy per octave (pink noise).
 * This is a broadband comparison reference, not a calibrated SPL/phon estimator.
 * Endpoints use trapezoidal weights. Peak subtraction avoids numerical overflow.
 */
export function curveReferenceLevel(
  curve: Pick<MeasuredCurve, 'points'> | null | undefined,
  settings: CurveDisplay,
) {
  if (!curve?.points?.length || settings.method === 'none') return 0;
  if (settings.method === '1k') return interpolate(curve.points, 1000);
  const key = `${settings.method}:${settings.minHz}:${settings.maxHz}`;
  let entries = levelCache.get(curve);
  if (!entries) {
    entries = new Map();
    levelCache.set(curve, entries);
  }
  if (entries.has(key)) return entries.get(key)!;
  const lo = Math.max(settings.minHz, curve.points[0][0]),
    hi = Math.min(settings.maxHz, curve.points.at(-1)![0]);
  if (lo >= hi) return interpolate(curve.points, Math.sqrt(settings.minHz * settings.maxHz));
  const db = Array.from({ length: 513 }, (_, i) =>
    interpolate(curve.points, lo * (hi / lo) ** (i / 512)),
  );
  const peak = Math.max(...db);
  const sum = db.reduce(
    (acc, value, i) =>
      acc +
      (i === 0 || i === 512 ? 0.5 : 1) *
        (settings.method === 'band-average' ? value : 10 ** ((value - peak) / 10)),
    0,
  );
  const level = settings.method === 'band-average' ? sum / 512 : peak + 10 * Math.log10(sum / 512);
  if (entries.size > 24) entries.clear();
  entries.set(key, level);
  return level;
}
export function curveShift(
  curve: Pick<MeasuredCurve, 'points'> | null | undefined,
  kind: CurveRole,
  settings: CurveDisplay,
) {
  const manual = settings[`${kind}OffsetDb`] ?? 0;
  return (
    manual +
    (settings.method === 'none' ? 0 : settings.referenceDb - curveReferenceLevel(curve, settings))
  );
}
