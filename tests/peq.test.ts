import type { Channel } from '../src/types.ts';
import type { BackendConfiguration } from '../src/backends/index.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newBand,
  newPreset,
  response,
  importPreset,
  exportPreset,
  exportText,
  parseCurve,
  curveValue,
  validateState,
  initialState,
} from '../src/model.ts';
import { createBackendController } from '../src/backends/index.ts';
const near = (actual: number, expected: number, tolerance = 0.001) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
test('extracted peak filter reaches specified center gain at each sample rate', () => {
  for (const sampleRate of [44100, 48000, 96000, 192000])
    for (const gain of [-12, -5, 0, 6, 12]) {
      near(response({ preampDb: -3, filters: [newBand(1000, gain)] }, 1000, sampleRate), gain - 3);
    }
});
test('bypassed bands and preamp combine correctly', () => {
  near(response({ preampDb: -4, filters: [{ ...newBand(1000, 9), enabled: false }] }, 1000), -4);
  near(response({ preampDb: -6, filters: [newBand(1000, 3), newBand(1000, 2)] }, 1000), -1);
});
test('shelves have correct low/high frequency asymptotes', () => {
  const low: Channel = { preampDb: 0, filters: [{ ...newBand(1000, 6), type: 'LSC', q: 0.7071 }] };
  near(response(low, 20), 6, 0.02);
  near(response(low, 20000), 0, 0.02);
  const high: Channel = { preampDb: 0, filters: [{ ...newBand(1000, 6), type: 'HSC', q: 0.7071 }] };
  near(response(high, 20), 0, 0.02);
  near(response(high, 20000), 6, 0.02);
});
test('low pass and high pass cut off at -3 dB for Butterworth Q', () => {
  for (const type of ['LP', 'HP'] as const)
    near(
      response({ preampDb: 0, filters: [{ ...newBand(1000), type, q: Math.SQRT1_2 }] }, 1000),
      -3.0103,
      0.001,
    );
});
test('TXT and stereo JSON round trip', () => {
  const p = newPreset('Test', {
    preampDb: -5.5,
    filters: [newBand(1200, 5.4), { ...newBand(60, 1), enabled: false }],
  });
  assert.deepEqual(importPreset(exportText(p.left), 'Text').left, p.left);
  p.linked = false;
  p.right.preampDb = -9;
  const back = importPreset(exportPreset(p), 'Json');
  assert.deepEqual(back.left, p.left);
  assert.deepEqual(back.right, p.right);
  assert.equal(back.linked, false);
  assert.equal(importPreset('Preamp: 0.0 dB', 'Flat').left.filters.length, 0);
});
test('text imports preserve repeated filter numbers as separate bands in line order', () => {
  const pair = [
    'Filter 1: ON PK Fc 33 Hz Gain 1.4 dB Q 0.4',
    'Filter 2: ON PK Fc 23 Hz Gain 3.5 dB Q 0.5',
  ];
  const expected = [
    { ...newBand(33, 1.4), q: 0.4 },
    { ...newBand(23, 3.5), q: 0.5 },
  ];
  const preset = importPreset([...pair, ...pair, ...pair].join('\n'), 'Repeated labels');
  assert.deepEqual(preset.left, {
    preampDb: 0,
    filters: [...expected, ...expected, ...expected],
  });
  assert.deepEqual(preset.right, preset.left);
  assert.deepEqual(importPreset(exportText(preset.left), 'Round trip').left, preset.left);
});
test('text imports accept missing filter numbers, with or without a colon', () => {
  for (const prefix of ['Filter:', 'Filter :', 'Filter', 'filter']) {
    for (const newline of ['\n', '\r\n', '\r']) {
      const preset = importPreset(
        [
          `${prefix} ON PK Fc 33 Hz Gain 1.4 dB Q 0.4`,
          `${prefix} ON PK Fc 23 Hz Gain 3.5 dB Q 0.5`,
        ].join(newline),
        'Unnumbered',
      );
      assert.deepEqual(preset.left.filters, [
        { ...newBand(33, 1.4), q: 0.4 },
        { ...newBand(23, 3.5), q: 0.5 },
      ]);
    }
  }
});
test('mixed text labels retain preamp, bypass, types and order without importing comments', () => {
  const preset = importPreset(
    [
      'Preamp: -4 dB',
      '# Filter 1: ON PK Fc 1000 Hz Gain 9 dB Q 1',
      'Filter 9: OFF LSC Fc 100 Hz Gain -2 dB Q 0.7',
      'Filter: ON HSC Fc 8000 Hz Gain 3 dB Q 0.8',
      'Filter 2: ON PK Fc 33 Hz Gain 1.4 dB Q 0.4',
    ].join('\n'),
    'Mixed labels',
  );
  assert.deepEqual(preset.left, {
    preampDb: -4,
    filters: [
      { ...newBand(100, -2), enabled: false, type: 'LSC', q: 0.7 },
      { ...newBand(8000, 3), type: 'HSC', q: 0.8 },
      { ...newBand(33, 1.4), q: 0.4 },
    ],
  });
});
test('malformed imports reject instead of silently corrupting filters', () => {
  assert.throws(() => importPreset('{}', 'Bad'), /No supported/);
  assert.throws(() => importPreset('not a filter', 'Bad'));
  assert.throws(() => importPreset(JSON.stringify({ filters: [newBand(0)] }), 'Bad'), /Frequency/);
  assert.throws(
    () => importPreset(JSON.stringify({ filters: [{ ...newBand(), type: 'unknown' }] }), 'Bad'),
    /Unsupported/,
  );
});
test('presets import, export and restore more than ten bands without truncation', () => {
  const p = newPreset('Many bands', {
    preampDb: -3,
    filters: Array.from({ length: 128 }, (_, i) => newBand(20 + i * 100, 0)),
  });
  assert.equal(importPreset(exportText(p.left), 'TXT').left.filters.length, 128);
  assert.equal(importPreset(exportPreset(p), 'JSON').left.filters.length, 128);
  const state = initialState();
  state.presets.push(p);
  assert.equal(
    validateState(JSON.parse(JSON.stringify(state))).presets.at(-1)!.left.filters.length,
    128,
  );
});
test('TOPPING hardware JSON uses the upstream numeric filter mapping and count', () => {
  const bands = Array.from({ length: 11 }, (_, i) => ({
    enabled: true,
    type: (i % 5) + 1,
    freqHz: 1000,
    gainDb: 2,
    q: 1,
  }));
  const p = importPreset(
    JSON.stringify({
      format: 'web_hid_peq_v1',
      hidPeqConfig: {
        filterNum: 5,
        bandsL: bands,
        bandsR: bands,
        preampGainL: -3,
        preampGainR: -4,
      },
    }),
    'Hardware',
  );
  assert.deepEqual(
    p.left.filters.map((f) => f.type),
    ['PK', 'LP', 'HP', 'LSC', 'HSC'],
  );
  assert.equal(p.right.preampDb, -4);
  assert.equal(p.linked, false);
});
test('TOPPING parameter CSV preserves frequency, gain and preamp', () => {
  const p = importPreset(
    'Preamp(dB): -4.00\nIndex,Enabled,Type,Frequency(Hz),Gain(dB),Q\n1,1,PK,500,3.00,1.2500',
    'CSV',
  );
  assert.equal(p.left.preampDb, -4);
  assert.equal(p.left.filters[0].fcHz, 500);
  assert.equal(p.left.filters[0].gainDb, 3);
});
test('measured curves interpolate logarithmically and normalize at 1 kHz', () => {
  const curve = parseCurve('frequency,dB\n100,2\n1000,6\n10000,10', 'Test');
  near(curveValue(curve, 1000), 0);
  near(curveValue(curve, Math.sqrt(100 * 1000)), -2);
  assert.throws(() => parseCurve('bad data', 'Bad'));
});
test('workspace supports thousands of presets without count limits', () => {
  const state = initialState();
  state.presets = Array.from({ length: 2000 }, (_, i) => newPreset(`Preset ${i}`));
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).presets.length, 2000);
});
test('backend stays disconnected until explicitly configured and applied', async () => {
  const backend = createBackendController();
  assert.equal(backend.status.id, null);
  await assert.rejects(() => backend.connect(), /No backend/);
  let received: BackendConfiguration | undefined;
  backend.register({
    id: 'test',
    name: 'Test',
    async connect() {},
    async disconnect() {},
    async apply(c) {
      received = c;
    },
  });
  const p = newPreset('Test');
  p.left.filters.push(newBand(1000, 3));
  p.enabled = false;
  await assert.rejects(() => backend.apply(p), /Connect/);
  await backend.connect();
  await backend.apply(p);
  assert.ok(received);
  assert.equal(received.enabled, false);
  assert.deepEqual(received.left, received.right);
  received.left.filters[0].gainDb = 9;
  assert.equal(p.left.filters[0].gainDb, 3);
  await backend.disconnect();
  assert.equal(backend.status.connected, false);
});
