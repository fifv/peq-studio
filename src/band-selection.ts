import type { Filter, Point } from './types.ts';
import { clamp } from './utils.ts';

export type BandParameter = 'fcHz' | 'gainDb' | 'q';

export function bandRange(anchor: number, target: number) {
  const first = Math.min(anchor, target),
    last = Math.max(anchor, target);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function pointsInRectangle(
  points: { index: number; point: Point }[],
  start: Point,
  end: Point,
) {
  const left = Math.min(start.x, end.x),
    right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y),
    bottom = Math.max(start.y, end.y);
  return points
    .filter(
      ({ point }) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom,
    )
    .map(({ index }) => index);
}

/** Apply one shared delta/ratio so limits never squash the spacing between bands. */
export function adjustBands(filters: Filter[], parameter: BandParameter, amount: number) {
  if (!filters.length || !Number.isFinite(amount)) return;
  if (parameter === 'gainDb') {
    for (const filter of filters)
      if (!['LP', 'HP'].includes(filter.type)) filter.gainDb = +(filter.gainDb + amount).toFixed(4);
    return;
  }
  if (amount <= 0) return;
  const min = parameter === 'fcHz' ? 20 : 0.1;
  const max = parameter === 'fcHz' ? 20000 : 20;
  const ratio = clamp(
    amount,
    Math.max(...filters.map((f) => min / f[parameter])),
    Math.min(...filters.map((f) => max / f[parameter])),
  );
  for (const filter of filters) filter[parameter] = +(filter[parameter] * ratio).toFixed(5);
}

export function stepBands(filters: Filter[], parameter: BandParameter, steps: number) {
  adjustBands(
    filters,
    parameter,
    parameter === 'gainDb' ? steps * 0.1 : (parameter === 'q' ? 1.05 : 1.02) ** steps,
  );
}
