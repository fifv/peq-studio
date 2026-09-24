// Extract only the two pure modules. The VM registers module factories; it does
// not run the application's module factories, network code, or account code.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const bundle = fs.readFileSync('reference/9910985b55cdcf2d.js', 'utf8');
const chunks: unknown[] = [];
vm.runInNewContext(bundle, { TURBOPACK: chunks }, { timeout: 1000 });
const factories = chunks.flat().filter((value) => typeof value === 'function');
fs.mkdirSync('src/vendor', { recursive: true });
for (const [name, marker, exports] of [
  [
    'topping-dsp',
    '"getTransferFunction"',
    [
      'getTransferFunction',
      'calculateFilterResponseDb',
      'calculateCombinedResponseDb',
      'normalizeFilterTypeCode',
      'normalizeConfig',
      'createFrequencyResponseKernel',
      'fillFilterResponseDb',
    ],
  ],
  ['topping-formats', '"toRewText"', ['parseAny', 'toRewText', 'toJsonText']],
] as const) {
  const factory = factories.find((fn) => fn.toString().includes(marker));
  if (!factory || /e\.i\(/.test(factory.toString())) throw Error('Pure module not found: ' + name);
  fs.writeFileSync(
    `src/vendor/${name}.js`,
    `// Extracted from TOPPING Home web v1.14.0 on 2026-09-23.\n// Original source: https://home.toppingaudio.com/_next/static/chunks/9910985b55cdcf2d.js\n// Original code remains subject to its owner's rights. See reference/PROVENANCE.md.\nconst api = {};\n(${factory.toString()})({s(values) { for(let i=0;i<values.length;) { const name=values[i++]; const entry=values[i++]; api[name]=entry===0?values[i++]:entry(); } }});\nexport const { ${exports.join(', ')} } = api;\n`,
  );
}
console.log(
  'Extracted DSP and import/export modules. SHA-256: ' +
    crypto.createHash('sha256').update(bundle).digest('hex'),
);
