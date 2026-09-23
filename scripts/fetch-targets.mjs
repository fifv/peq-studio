import { mkdir, writeFile } from 'node:fs/promises';
const base = 'https://home.toppingaudio.com/autoeq/target-curve-library';
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${url}: ${response.status}`);
  return response.json();
}
const catalog = await json(`${base}/targets.json`);
const targets = await Promise.all(catalog.targets.map(async target => {
  const sourceUrl = `${base}/curves/${encodeURIComponent(target.id)}.json`;
  const data = await json(sourceUrl);
  const points = data.points.filter(p => p.length === 2 && p.every(Number.isFinite) && p[0] >= 20 && p[0] <= 20000).sort((a,b)=>a[0]-b[0]);
  if (points.length < 2) throw Error(`Invalid curve: ${target.name}`);
  return { ...target, id: `builtin:${target.id}`, upstreamId: target.id, kind: 'target', builtin: true, sourceUrl, points };
}));
await mkdir('src/data', { recursive: true });
await writeFile('src/data/builtin-targets.json', JSON.stringify({ sourceUrl: `${base}/targets.json`, dataset: catalog.dataset, version: catalog.version, license: catalog.license, targets }));
console.log(`Bundled ${targets.length} targets (${targets.reduce((n,t)=>n+t.points.length,0)} points).`);
