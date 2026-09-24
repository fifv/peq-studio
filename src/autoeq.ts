import type {
  AutoEqOptions,
  AutoEqRequest,
  AutoEqProgress,
  AutoEqResult,
  Filter,
  FilterType,
  MeasuredCurve,
} from './types.ts';
import { clamp } from './utils.ts';
import { getTransferFunction, calculateCombinedResponseDb } from './response.ts';
import { interpolate } from './curve-math.ts';
import { curveShift, normalizeCurveDisplay } from './curve-level.ts';

export const defaultAutoEqOptions = (): AutoEqOptions => ({
  maxBands: 10,
  minHz: 20,
  maxHz: 10000,
  maxBoost: 6,
  maxCut: 12,
  minQ: 0.3,
  maxQ: 6,
  smoothing: 1 / 6,
  shelves: true,
  safePreamp: true,
});
export function validateAutoEqOptions(input: unknown = {}) {
  const o = {
    ...defaultAutoEqOptions(),
    ...(input && typeof input === 'object' ? input : {}),
  } as AutoEqOptions;
  for (const [key, min, max] of [
    ['maxBands', 1, Number.MAX_SAFE_INTEGER],
    ['minHz', 20, 20000],
    ['maxHz', 20, 20000],
    ['maxBoost', 0, 60],
    ['maxCut', 0, 60],
    ['minQ', 0.1, 20],
    ['maxQ', 0.1, 20],
    ['smoothing', 0, 1],
  ] as const) {
    if (!Number.isFinite(o[key]) || o[key] < min || o[key] > max) throw Error(`Invalid ${key}.`);
  }
  if (!Number.isInteger(o.maxBands)) throw Error('Band count must be a whole number.');
  if (o.minHz >= o.maxHz) throw Error('From frequency must be lower than To frequency.');
  if (o.minQ > o.maxQ) throw Error('Minimum Q must not exceed maximum Q.');
  if (o.maxBoost === 0 && o.maxCut === 0) throw Error('Allow some boost or cut.');
  o.shelves = !!o.shelves;
  o.safePreamp = !!o.safePreamp;
  return o;
}

const error = (a: number[], b: number[]) =>
  a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length;
function validateCurve(curve: Pick<MeasuredCurve, 'points'>, label: string) {
  if (
    !Array.isArray(curve?.points) ||
    curve.points.length < 2 ||
    curve.points.some(
      (p, i) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        p[0] <= 0 ||
        (i && p[0] <= curve.points[i - 1][0]),
    )
  )
    throw Error(`Choose a valid ${label} curve.`);
}
/** Greedy biquad selection followed by bounded coordinate refinement. The
 * objective uses equally spaced log-frequency samples, never existing bands.
 * This is a local fitter, not the upstream AutoEq project's optimizer. */
export function generateAutoEq(
  { source, target, display, options, sampleRate = 48000 }: AutoEqRequest,
  onProgress: (progress: AutoEqProgress) => void = () => {},
): AutoEqResult {
  const o = validateAutoEqOptions(options);
  validateCurve(source, 'source');
  validateCurve(target, 'target');
  if (![44100, 48000, 96000, 192000].includes(sampleRate)) throw Error('Unsupported sample rate.');
  const lo = Math.max(o.minHz, source.points[0][0], target.points[0][0]);
  const hi = Math.min(o.maxHz, source.points.at(-1)![0], target.points.at(-1)![0]);
  if (lo >= hi) throw Error('The source and target have no shared data in this frequency range.');
  const n = 256,
    frequencies = Array.from({ length: n }, (_, i) => lo * (hi / lo) ** (i / (n - 1)));
  const level = normalizeCurveDisplay(display),
    shift = curveShift(target, 'target', level) - curveShift(source, 'source', level);
  const raw = frequencies.map(
    (hz) => interpolate(target.points, hz) - interpolate(source.points, hz) + shift,
  );
  const octaves = Math.log2(hi / lo),
    sigma = o.smoothing / 2.355;
  const smoothed = !sigma
    ? raw
    : raw.map((_, i) => {
        let sum = 0,
          weight = 0;
        for (let j = 0; j < n; j++) {
          const distance = ((i - j) * octaves) / (n - 1);
          if (Math.abs(distance) > sigma * 3) continue;
          const w = Math.exp(-0.5 * (distance / sigma) ** 2);
          sum += w * raw[j];
          weight += w;
        }
        return sum / weight;
      });
  const desired = smoothed.map((db) => clamp(db, -o.maxCut, o.maxBoost));
  const trig = frequencies.map((hz) => {
    const w = (2 * Math.PI * hz) / sampleRate;
    return [Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w)];
  });
  const sampling = { samplingFrequencyHz: sampleRate };
  function response(filter: Filter) {
    const { num: a, den: b } = getTransferFunction(
      filter.type,
      filter.fcHz,
      filter.gainDb,
      filter.q,
      sampling,
    );
    return trig.map(
      ([c, s, c2, s2]) =>
        10 *
        Math.log10(
          Math.max(1e-30, (a[0] + a[1] * c + a[2] * c2) ** 2 + (a[1] * s + a[2] * s2) ** 2) /
            Math.max(1e-30, (b[0] + b[1] * c + b[2] * c2) ** 2 + (b[1] * s + b[2] * s2) ** 2),
        ),
    );
  }
  const shape = (type: FilterType, fcHz: number, q: number, gainDb: number): Filter => ({
    enabled: true,
    type,
    fcHz,
    gainDb,
    q,
  });
  const dictionary = [];
  for (let i = 0; i < 48; i++)
    for (const q of new Set([o.minQ, 0.5, 1, 2, 4, o.maxQ].map((q) => clamp(q, o.minQ, o.maxQ)))) {
      const f = shape('PK', lo * (hi / lo) ** (i / 47), q, 1);
      dictionary.push({ f, unit: response(f) });
    }
  if (o.shelves)
    for (const type of ['LSC', 'HSC'] as const)
      for (let i = 0; i < 16; i++) {
        const f = shape(
          type,
          lo * (hi / lo) ** (i / 15),
          clamp(Math.SQRT1_2, o.minQ, Math.min(o.maxQ, 1)),
          1,
        );
        dictionary.push({ f, unit: response(f) });
      }
  function refine(filter: Filter, residual: number[]) {
    let f = { ...filter },
      values = response(f),
      loss = error(residual, values),
      steps = [0.18, 2, 0.3];
    for (let pass = 0; pass < 36; pass++) {
      let improved = false;
      for (let axis = 0; axis < 3; axis++) {
        if (axis === 2 && f.type !== 'PK') continue;
        for (const direction of [-1, 1]) {
          const next = { ...f };
          if (axis === 0) next.fcHz = clamp(f.fcHz * Math.exp(direction * steps[0]), lo, hi);
          if (axis === 1)
            next.gainDb = clamp(f.gainDb + direction * steps[1], -o.maxCut, o.maxBoost);
          if (axis === 2) next.q = clamp(f.q * Math.exp(direction * steps[2]), o.minQ, o.maxQ);
          const nextValues = response(next),
            nextLoss = error(residual, nextValues);
          if (nextLoss < loss - 1e-9) {
            f = next;
            values = nextValues;
            loss = nextLoss;
            improved = true;
          }
        }
      }
      if (!improved) steps = steps.map((step) => step * 0.5);
      if (steps[1] < 0.01) break;
    }
    return { f, values, loss };
  }
  const fitted: ReturnType<typeof refine>[] = [];
  let total = Array(n).fill(0),
    loss = error(desired, total);
  for (let band = 0; band < o.maxBands; band++) {
    if (loss < 0.0025) break;
    const residual = desired.map((db, i) => db - total[i]);
    let best: ReturnType<typeof refine> | null = null;
    for (const { f, unit } of dictionary) {
      const gain = clamp(
        unit.reduce((sum, value, i) => sum + value * residual[i], 0) /
          Math.max(
            1e-12,
            unit.reduce((sum, value) => sum + value * value, 0),
          ),
        -o.maxCut,
        o.maxBoost,
      );
      if (Math.abs(gain) < 0.05) continue;
      const next = { ...f, gainDb: gain },
        values = response(next),
        candidateLoss = error(residual, values);
      if (!best || candidateLoss < best.loss) best = { f: next, values, loss: candidateLoss };
    }
    if (!best) break;
    best = refine(best.f, residual);
    if (loss - best.loss < 0.0005) break;
    fitted.push(best);
    total = total.map((db, i) => db + best!.values[i]);
    // Refit each band against the residual of the others to handle overlap.
    for (let sweep = 0; sweep < 2; sweep++)
      for (let i = 0; i < fitted.length; i++) {
        const previous = fitted[i],
          without = total.map((db, j) => db - previous.values[j]);
        fitted[i] = refine(
          previous.f,
          desired.map((db, j) => db - without[j]),
        );
        total = without.map((db, j) => db + fitted[i].values[j]);
      }
    loss = error(desired, total);
    onProgress({ bands: fitted.length, maxBands: o.maxBands, rmse: Math.sqrt(loss) });
  }
  let filters = fitted
    .map(({ f }) => ({
      ...f,
      fcHz: +f.fcHz.toFixed(2),
      gainDb: +f.gainDb.toFixed(3),
      q: +f.q.toFixed(4),
    }))
    .filter((f) => Math.abs(f.gainDb) >= 0.05)
    .sort((a, b) => a.fcHz - b.fcHz);
  const auditHz = Array.from({ length: 2048 }, (_, i) => 20 * 1000 ** (i / 2047));
  const measure = () => auditHz.map((hz) => calculateCombinedResponseDb(filters, 0, hz, sampling));
  // Overlapping bands may exceed the requested total correction limits.
  // Reduce their gains together until the sampled full-band envelope fits.
  let audit = measure();
  for (let pass = 0; pass < 12; pass++) {
    const peak = Math.max(0, ...audit),
      cut = Math.max(0, ...audit.map((db) => -db));
    const scale = Math.min(
      1,
      peak > o.maxBoost + 0.001 ? o.maxBoost / peak : 1,
      cut > o.maxCut + 0.001 ? o.maxCut / cut : 1,
    );
    if (scale >= 1) break;
    filters = filters.map((f) => ({ ...f, gainDb: f.gainDb * scale }));
    audit = measure();
  }
  filters = filters.filter((f) => Math.abs(f.gainDb) >= 0.01);
  audit = measure();
  const peak = Math.max(0, ...audit),
    preampDb = o.safePreamp ? -Math.ceil(peak * 10) / 10 : 0;
  const final = frequencies.map((hz) => calculateCombinedResponseDb(filters, 0, hz, sampling));
  return {
    filters,
    preampDb,
    fit: {
      before: Math.sqrt(error(smoothed, Array(n).fill(0))),
      after: Math.sqrt(error(smoothed, final)),
      minHz: lo,
      maxHz: hi,
    },
    options: o,
  };
}
