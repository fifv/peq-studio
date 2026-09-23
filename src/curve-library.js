import catalog from './data/builtin-targets.json' with { type: 'json' };
import sources from './data/builtin-sources.json' with { type: 'json' };

export const BUILTIN_TARGETS = catalog.targets;
export const TARGET_CATALOG_VERSION = catalog.version;
export const BUILTIN_SOURCES = sources.models;
export const SOURCE_CATALOG_VERSION = sources.version;
const sourceCache = new Map(), pending = new Map();
const builtinById = new Map([...BUILTIN_TARGETS,...BUILTIN_SOURCES].map(curve=>[curve.id,curve]));
export const builtinCurves = kind => kind === 'target' ? BUILTIN_TARGETS : BUILTIN_SOURCES;
export async function loadBuiltinCurve(_kind, id, fetcher = fetch) {
  // The selector role does not restrict which built-in collection it can use.
  const curve = builtinById.get(id);
  if (!curve || curve.points) return curve;
  if (sourceCache.has(id)) return sourceCache.get(id);
  if (pending.has(id)) return pending.get(id);
  const request = (async()=>{
    const response = await fetcher(`${import.meta.env?.BASE_URL ?? '/'}curves/sources/${encodeURIComponent(curve.responseFile)}`);
    if (!response.ok) throw Error(`Cannot load ${curve.name}. Please retry.`);
    const data = await response.json();
    if (!Array.isArray(data.points) || data.points.length < 2 || data.points.some((p,i)=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<20||p[0]>20000||(i>0&&p[0]<=data.points[i-1][0]))) throw Error(`Invalid response data for ${curve.name}.`);
    const loaded = {...curve,points:data.points};sourceCache.set(id,loaded);return loaded;
  })();
  pending.set(id,request);
  try { return await request; } finally { pending.delete(id); }
}
export function customCurves(state) {
  // Existing source/target tags are retained for backup compatibility, but do
  // not restrict selection: every import belongs to the shared custom library.
  return state.curves;
}
export function findCurve(state, kind, id = state[`${kind}Id`]) {
  return customCurves(state, kind).find(curve => curve.id === id)
    ?? sourceCache.get(id)
    ?? builtinById.get(id);
}
export function searchCurves(curves, query) {
  const words = query.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return curves.filter(curve => {
    const text = `${curve.name} ${curve.brand ?? ''} ${curve.category ?? ''} ${curve.measurementSystem ?? ''}`.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    return words.every(word => text.includes(word));
  });
}
export function removeCustomCurve(state, id) {
  if (!state.curves.some(curve => curve.id === id)) return false;
  state.curves = state.curves.filter(curve => curve.id !== id);
  for (const kind of ['target', 'source']) if (state[`${kind}Id`] === id) state[`${kind}Id`] = '';
  return true;
}
