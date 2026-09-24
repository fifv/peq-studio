import { fetchJson } from './http.ts';
import type { Catalog, CurveFile } from './http.ts';
import { readCurvePoints } from '../src/validation.ts';
import type { Curve } from '../src/types.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = 'https://home.toppingaudio.com/autoeq/headphone-library';
const catalog = await fetchJson<Catalog>(`${base}/models.json`);
await mkdir('public/curves/sources', { recursive: true });
await mkdir('src/data', { recursive: true });
let next = 0,
  completed = 0;
const models: (Curve & { model: string; upstreamId: string })[] = new Array(catalog.models.length);
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < catalog.models.length) {
      const index = next++,
        model = catalog.models[index];
      const file = `${model.id}.json`,
        sourceUrl = `${base}/curves/${encodeURIComponent(model.id)}.json`;
      let data: CurveFile;
      try {
        data = JSON.parse(await readFile(`public/curves/sources/${file}`, 'utf8'));
      } catch {
        data = await fetchJson<CurveFile>(sourceUrl);
      }
      const points = readCurvePoints(data.points);
      if (points.length < 2) throw Error(`Invalid curve: ${model.name}`);
      await writeFile(`public/curves/sources/${file}`, JSON.stringify({ points }));
      models[index] = {
        ...model,
        name: `${model.brand ?? ''} ${model.name}`.trim(),
        model: model.name,
        id: `builtin-source:${model.id}`,
        upstreamId: model.id,
        kind: 'source',
        builtin: true,
        responseFile: file,
        pointCount: points.length,
        sourceUrl,
      };
      completed++;
      if (completed % 75 === 0)
        console.log(`${completed}/${catalog.models.length} responses bundled`);
    }
  }),
);
await writeFile(
  'src/data/builtin-sources.json',
  JSON.stringify({
    sourceUrl: `${base}/models.json`,
    dataset: catalog.dataset,
    version: catalog.version,
    license: catalog.license,
    models,
  }),
);
console.log(
  `Bundled ${models.length} source responses. Each loads from a local file when selected.`,
);
