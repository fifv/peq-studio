import type { CurvePoint } from './types.ts';
export function interpolate(points: CurvePoint[], hz: number) {
  if (hz <= points[0][0]) return points[0][1];
  let low = 0,
    high = points.length - 1;
  if (hz >= points[high][0]) return points[high][1];
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid][0] < hz) low = mid;
    else high = mid;
  }
  const [f0, d0] = points[low],
    [f1, d1] = points[high];
  return d0 + ((d1 - d0) * Math.log(hz / f0)) / Math.log(f1 / f0);
}
