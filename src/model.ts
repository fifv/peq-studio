import type {
  Channel,
  Filter,
  FilterType,
  Preset,
  Workspace,
  Curve,
  MeasuredCurve,
} from './types.ts';
import { clone } from './utils.ts';
import { record, readCurvePoints, bounded as number, finite as gain } from './validation.ts';
import { parseAny, toRewText } from './vendor/topping-formats.js';
import { normalizeFilterTypeCode, calculateCombinedResponseDb } from './response.ts';
import { interpolate } from './curve-math.ts';
import { defaultCurveDisplay, normalizeCurveDisplay } from './curve-level.ts';
import { defaultAutoEqOptions, validateAutoEqOptions } from './autoeq.ts';
export { interpolate } from './curve-math.ts';

export const TYPES: Record<FilterType, string> = {
  PK: 'Peak',
  LSC: 'Low shelf',
  HSC: 'High shelf',
  LP: 'Low pass',
  HP: 'High pass',
};
export const COLORS = [
  '#a5a8f4',
  '#80bbd4',
  '#76d4c8',
  '#82ce91',
  '#bada7c',
  '#ecd277',
  '#efa57c',
  '#e28fae',
  '#bd92e8',
  '#77b5f2',
];
export const bandColor = (index: number) =>
  COLORS[index] ?? `hsl(${Math.round((index * 137.508) % 360)} 62% 70%)`;
export const FREQUENCIES = Array.from({ length: 512 }, (_, i) => 20 * 1000 ** (i / 511));
export { clone, clamp } from './utils.ts';
export const newBand = (fcHz = 1000, gainDb = 0): Filter => ({
  type: 'PK',
  enabled: true,
  fcHz,
  gainDb,
  q: 1,
});
export const newPreset = (
  name = 'Untitled preset',
  channel: Channel = { preampDb: 0, filters: [] },
): Preset => ({
  id: crypto.randomUUID(),
  name,
  linked: true,
  enabled: true,
  left: clone(channel),
  right: clone(channel),
});
export function initialState(): Workspace {
  const example = newPreset('Cloud Config 20 · example', {
    preampDb: -5.5,
    filters: [
      { ...newBand(60, 1), enabled: false },
      { ...newBand(80, 2), enabled: false },
      { ...newBand(35, 5.4), enabled: false, q: 0.7 },
      { ...newBand(12000, -5.4), q: 5.5 },
      { ...newBand(3000, 5.3), q: 1.5 },
      { ...newBand(1200, 5.4), q: 1.5 },
    ],
  });
  const flat = newPreset('Flat reference');
  return {
    version: 1,
    presets: [example, flat],
    activeId: example.id,
    curves: [],
    targetId: '',
    sourceId: '',
    sampleRate: 48000,
    curveDisplay: defaultCurveDisplay(),
    autoEqOptions: defaultAutoEqOptions(),
  };
}
export function validateChannel(value: unknown): Channel {
  const channel = record(value);
  if (!channel || !Array.isArray(channel.filters)) throw Error('Missing filter list.');
  return {
    preampDb: gain(channel.preampDb ?? 0, 'Preamp'),
    filters: channel.filters.map((value) => {
      const filter = record(value);
      const code = String(filter.type ?? 'PK').toUpperCase();
      const aliases = [
        'PEAK',
        'PEAKING',
        'LS',
        'LOW_SHELF',
        'LOWSHELF',
        'HS',
        'HIGH_SHELF',
        'HIGHSHELF',
        'LOWPASS',
        'LOW_PASS',
        'HIGHPASS',
        'HIGH_PASS',
      ];
      if (!Object.hasOwn(TYPES, code) && !aliases.includes(code))
        throw Error(`Unsupported filter type: ${code}`);
      return {
        type: normalizeFilterTypeCode(code),
        enabled: filter.enabled !== false,
        fcHz: number(filter.fcHz, 20, 20000, 'Frequency'),
        gainDb: gain(filter.gainDb, 'Gain'),
        q: number(filter.q, 0.1, 20, 'Q'),
      };
    }),
  };
}
/** Filter labels are optional metadata, not unique band IDs. The upstream
 * parser keys bands by number, so give each text line its own sequential ID. */
function normalizeTextFilterLabels(text: string): string {
  let index = 0;
  return text
    .split(/\r\n?|\n/)
    .map((line) =>
      line.replace(/^\s*filter\b(?:\s+\d+)?\s*:?\s*(?=(?:on|off)\b)/i, () => `Filter ${++index}: `),
    )
    .join('\n');
}

export function importPreset(text: string, name: string): Preset {
  let json: Record<string, unknown> | unknown[] | undefined;
  if (/^[\s]*[\[{]/.test(text)) json = JSON.parse(text);
  if (json && !Array.isArray(json) && json.format === 'peq-studio' && json.preset) {
    const p = record(json.preset);
    return {
      ...newPreset(String(p.name || name)),
      linked: p.linked !== false,
      enabled: p.enabled !== false,
      left: validateChannel(p.left),
      right: validateChannel(p.linked !== false ? p.left : p.right),
    };
  }
  const p =
    json && !Array.isArray(json) ? record(json.hidPeqConfig ?? json.peq ?? json) : undefined;
  if (p && Array.isArray(p.bandsL)) {
    const convert = (bands: unknown[]) =>
      bands.slice(0, typeof p.filterNum === 'number' ? p.filterNum : bands.length).map((value) => {
        const b = record(value);
        return {
          ...b,
          type:
            typeof b.type === 'number'
              ? (['PK', 'PK', 'LP', 'HP', 'LSC', 'HSC'][b.type] ?? 'UNKNOWN')
              : b.type,
          fcHz: b.freqHz ?? b.fcHz ?? b.freq,
        };
      });
    const left = validateChannel({ preampDb: p.preampGainL ?? 0, filters: convert(p.bandsL) });
    const right = validateChannel({
      preampDb: p.preampGainR ?? p.preampGainL ?? 0,
      filters: convert(Array.isArray(p.bandsR) ? p.bandsR : p.bandsL),
    });
    return {
      ...newPreset(name, left),
      right,
      linked: JSON.stringify(left) === JSON.stringify(right),
    };
  }
  // The upstream parser rejects a valid flat, zero-preamp TXT. Handle that case here.
  const normalizedText = (json ? text : normalizeTextFilterLabels(text))
    .replace(/Frequency\(Hz\)/gi, 'frequency')
    .replace(/Gain\(dB\)/gi, 'gain')
    .replace(/^Preamp\(dB\):\s*([-+\d.]+)\s*$/gim, '# Preamp(dB): $1');
  const channel = /^\s*Preamp:\s*0(?:\.0+)?\s*dB\s*$/i.test(text)
    ? { preampDb: 0, filters: [] }
    : record(parseAny(normalizedText.replace(/^# Preamp\(dB\):.*\r?\n/m, '')));
  const csvPreamp = /^Preamp\(dB\):\s*([-+\d.]+)/im.exec(text);
  if (csvPreamp) channel.preampDb = Number(csvPreamp[1]);
  if (json && !Array.isArray(json) && !Array.isArray(json.filters) && !Array.isArray(p?.bands))
    throw Error('No supported PEQ filters found in this JSON.');
  return newPreset(name, validateChannel(channel));
}
export function exportPreset(preset: Preset) {
  return JSON.stringify({ format: 'peq-studio', version: 1, preset }, null, 2);
}
export function exportText(channel: Channel) {
  return toRewText(channel);
}
export function parseCurve(text: string, name: string): MeasuredCurve {
  const points = new Map<number, number>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[#*;]/.test(line)) continue;
    const cells = line.trim().split(/[,\t ]+/);
    if (cells.length < 2) continue;
    const [hz, db] = cells.map(Number);
    if (
      Number.isFinite(hz) &&
      Number.isFinite(db) &&
      hz >= 20 &&
      hz <= 20000 &&
      Math.abs(db) <= 300
    )
      points.set(hz, db);
  }
  if (points.size < 2)
    throw Error('Curve needs at least two frequency / dB rows between 20 Hz and 20 kHz.');
  return { id: crypto.randomUUID(), name, points: [...points].sort((a, b) => a[0] - b[0]) };
}
export function curveValue(
  curve: Pick<MeasuredCurve, 'points'> | null | undefined,
  hz: number,
  normalize = true,
) {
  return curve
    ? interpolate(curve.points, hz) - (normalize ? interpolate(curve.points, 1000) : 0)
    : 0;
}
export function response(channel: Channel, hz: number, sampleRate = 48000) {
  return calculateCombinedResponseDb(channel.filters, channel.preampDb, hz, {
    samplingFrequencyHz: sampleRate,
  });
}
export function validateState(value: unknown): Workspace {
  const state = record(value);
  if (state?.version !== 1 || !Array.isArray(state.presets) || !state.presets.length)
    throw Error('Invalid saved workspace.');
  const presets: Preset[] = state.presets.map((value) => {
    const p = record(value);
    if (typeof p.id !== 'string' || typeof p.name !== 'string') throw Error('Invalid preset name.');
    return {
      id: p.id,
      name: p.name,
      linked: p.linked !== false,
      enabled: p.enabled !== false,
      left: validateChannel(p.left),
      right: validateChannel(p.right),
    };
  });
  if (!Array.isArray(state.curves)) throw Error('Invalid saved curves.');
  const curves: MeasuredCurve[] = state.curves.map((value) => {
    const c = record(value);
    if (
      typeof c.id !== 'string' ||
      typeof c.name !== 'string' ||
      /^builtin[:-]/.test(c.id) ||
      (c.kind && !['source', 'target', 'both'].includes(String(c.kind)))
    )
      throw Error('Invalid custom curve.');
    return {
      ...c,
      id: c.id,
      name: c.name,
      kind: c.kind as Curve['kind'],
      points: readCurvePoints(c.points),
    };
  });
  let autoEqOptions;
  try {
    autoEqOptions = validateAutoEqOptions(state.autoEqOptions);
  } catch {
    autoEqOptions = defaultAutoEqOptions();
  }
  return {
    version: 1,
    presets,
    curves,
    activeId: presets.some((p) => p.id === state.activeId) ? String(state.activeId) : presets[0].id,
    targetId: typeof state.targetId === 'string' ? state.targetId : '',
    sourceId: typeof state.sourceId === 'string' ? state.sourceId : '',
    sampleRate:
      typeof state.sampleRate === 'number' &&
      [44100, 48000, 96000, 192000].includes(state.sampleRate)
        ? state.sampleRate
        : 48000,
    curveDisplay: normalizeCurveDisplay(state.curveDisplay),
    autoEqOptions,
  };
}
