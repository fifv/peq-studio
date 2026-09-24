import { fetchJson } from './http.ts';
import type { Catalog, CurveFile } from './http.ts';
import { readCurvePoints } from '../src/validation.ts';
import { mkdir, writeFile } from 'node:fs/promises';
const base = 'https://home.toppingaudio.com/autoeq/target-curve-library';
const catalog = await fetchJson<Catalog>(`${base}/targets.json`);
const targets = await Promise.all(
  catalog.targets.map(async (target) => {
    const sourceUrl = `${base}/curves/${encodeURIComponent(target.id)}.json`;
    const data = await fetchJson<CurveFile>(sourceUrl);
    const points = readCurvePoints(data.points);
    if (points.length < 2) throw Error(`Invalid curve: ${target.name}`);
    return {
      ...target,
      id: `builtin:${target.id}`,
      upstreamId: target.id,
      kind: 'target',
      builtin: true,
      sourceUrl,
      points,
    };
  }),
);
await mkdir('src/data', { recursive: true });
await writeFile(
  'src/data/builtin-targets.json',
  JSON.stringify({
    sourceUrl: `${base}/targets.json`,
    dataset: catalog.dataset,
    version: catalog.version,
    license: catalog.license,
    targets,
  }),
);
console.log(
  `Bundled ${targets.length} targets (${targets.reduce((n, t) => n + t.points.length, 0)} points).`,
);
