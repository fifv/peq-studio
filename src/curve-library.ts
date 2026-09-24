import type { Curve, MeasuredCurve, CurveRole, Workspace } from './types.ts';
import { curveRoles } from './utils.ts';
import { readCurvePoints, record } from './validation.ts';
type CurveFetcher = (url: string) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>;
import catalog from './data/builtin-targets.json' with { type: 'json' };
import sources from './data/builtin-sources.json' with { type: 'json' };

export const BUILTIN_TARGETS = catalog.targets.map((curve) => ({
  ...curve,
  kind: 'target' as const,
  points: readCurvePoints(curve.points, true),
}));
export const TARGET_CATALOG_VERSION = catalog.version;
export const BUILTIN_SOURCES: Curve[] = sources.models.map((curve) => ({
  ...curve,
  kind: 'source',
}));
export const SOURCE_CATALOG_VERSION = sources.version;
const sourceCache = new Map<string, MeasuredCurve>(),
  pending = new Map<string, Promise<MeasuredCurve>>();
const builtinById = new Map<string, Curve>(
  [...BUILTIN_TARGETS, ...BUILTIN_SOURCES].map((curve) => [curve.id, curve]),
);
export const builtinCurves = (kind: CurveRole) =>
  kind === 'target' ? BUILTIN_TARGETS : BUILTIN_SOURCES;
export async function loadBuiltinCurve(
  _kind: CurveRole,
  id: string,
  fetcher: CurveFetcher = fetch,
) {
  // The selector role does not restrict which built-in collection it can use.
  const curve = builtinById.get(id);
  if (!curve || curve.points) return curve;
  if (sourceCache.has(id)) return sourceCache.get(id);
  if (pending.has(id)) return pending.get(id);
  const request = (async () => {
    const response = await fetcher(
      `${import.meta.env?.BASE_URL ?? '/'}curves/sources/${encodeURIComponent(curve.responseFile!)}`,
    );
    if (!response.ok) throw Error(`Cannot load ${curve.name}. Please retry.`);
    const data = record(await response.json!());
    const points = readCurvePoints(data.points, true);
    const loaded: MeasuredCurve = { ...curve, points };
    sourceCache.set(id, loaded);
    return loaded;
  })();
  pending.set(id, request);
  try {
    return await request;
  } finally {
    pending.delete(id);
  }
}
export function customCurves(state: Workspace, _kind?: CurveRole) {
  // Existing source/target tags are retained for backup compatibility, but do
  // not restrict selection: every import belongs to the shared custom library.
  return state.curves;
}
export function findCurve(state: Workspace, kind: CurveRole, id = state[`${kind}Id`]) {
  return (
    customCurves(state, kind).find((curve) => curve.id === id) ??
    sourceCache.get(id) ??
    builtinById.get(id)
  );
}
export function searchCurves<T extends Curve>(curves: T[], query: string): T[] {
  const words = query
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return curves.filter((curve) => {
    const text =
      `${curve.name} ${curve.brand ?? ''} ${curve.category ?? ''} ${curve.measurementSystem ?? ''}`
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
export function removeCustomCurve(state: Workspace, id: string) {
  if (!state.curves.some((curve) => curve.id === id)) return false;
  state.curves = state.curves.filter((curve) => curve.id !== id);
  for (const kind of curveRoles) if (state[`${kind}Id`] === id) state[`${kind}Id`] = '';
  return true;
}
