import type { CurvePoint } from './types.ts';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Expected an object.');
  return value as Record<string, unknown>;
}
export function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw Error(`${label} must be a finite number.`);
  return value;
}
export function bounded(value: unknown, min: number, max: number, label: string): number {
  const result = finite(value, label);
  if (result < min || result > max) throw Error(`${label} must be between ${min} and ${max}.`);
  return result;
}
export function isCurvePoint(value: unknown): value is CurvePoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}
export function readCurvePoints(value: unknown, ordered = false): CurvePoint[] {
  if (!Array.isArray(value) || value.length < 2 || !value.every(isCurvePoint))
    throw Error('Invalid curve points.');
  if (
    value.some(
      (point, index) =>
        point[0] < 20 ||
        point[0] > 20000 ||
        (ordered && index > 0 && point[0] <= value[index - 1][0]),
    )
  )
    throw Error('Invalid curve frequencies.');
  return value.slice().sort((a, b) => a[0] - b[0]);
}
