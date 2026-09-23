import { parseAny, toRewText } from './vendor/topping-formats.js';
import { normalizeFilterTypeCode, calculateCombinedResponseDb } from './response.js';
import { interpolate } from './curve-math.js';
import { defaultCurveDisplay, normalizeCurveDisplay } from './curve-level.js';
import { defaultAutoEqOptions, validateAutoEqOptions } from './autoeq.js';
export { interpolate } from './curve-math.js';

export const TYPES = { PK: 'Peak', LSC: 'Low shelf', HSC: 'High shelf', LP: 'Low pass', HP: 'High pass' };
export const COLORS = ['#a5a8f4', '#80bbd4', '#76d4c8', '#82ce91', '#bada7c', '#ecd277', '#efa57c', '#e28fae', '#bd92e8', '#77b5f2'];
export const bandColor = index => COLORS[index] ?? `hsl(${Math.round((index*137.508)%360)} 62% 70%)`;
export const FREQUENCIES = Array.from({ length: 512 }, (_, i) => 20 * 1000 ** (i / 511));
export const clone = value => structuredClone(value);
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const newBand = (fcHz = 1000, gainDb = 0) => ({ type: 'PK', enabled: true, fcHz, gainDb, q: 1 });
export const newPreset = (name = 'Untitled preset', channel = { preampDb: 0, filters: [] }) => ({ id: crypto.randomUUID(), name, linked: true, enabled: true, left: clone(channel), right: clone(channel) });
export function initialState() {
  const example = newPreset('Cloud Config 20 · example', { preampDb: -5.5, filters: [
    { ...newBand(60, 1), enabled: false }, { ...newBand(80, 2), enabled: false },
    { ...newBand(35, 5.4), enabled: false, q: .7 }, { ...newBand(12000, -5.4), q: 5.5 },
    { ...newBand(3000, 5.3), q: 1.5 }, { ...newBand(1200, 5.4), q: 1.5 },
  ] });
  const flat = newPreset('Flat reference');
  return { version: 1, presets: [example, flat], activeId: example.id, curves: [], targetId: '', sourceId: '', sampleRate: 48000, curveDisplay:defaultCurveDisplay(), autoEqOptions:defaultAutoEqOptions() };
}
function number(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
function gain(value, label) {
  if (!Number.isFinite(value)) throw Error(`${label} must be a finite number.`);
  return value;
}
export function validateChannel(channel) {
  if (!channel || !Array.isArray(channel.filters)) throw Error('Missing filter list.');
  return { preampDb: gain(channel.preampDb ?? 0, 'Preamp'), filters: channel.filters.map(filter => {
    const code = String(filter.type ?? 'PK').toUpperCase();
    const aliases = ['PEAK', 'PEAKING', 'LS', 'LOW_SHELF', 'LOWSHELF', 'HS', 'HIGH_SHELF', 'HIGHSHELF', 'LOWPASS', 'LOW_PASS', 'HIGHPASS', 'HIGH_PASS'];
    if (!TYPES[code] && !aliases.includes(code)) throw Error(`Unsupported filter type: ${code}`);
    return { type: normalizeFilterTypeCode(code), enabled: filter.enabled !== false,
      fcHz: number(filter.fcHz, 20, 20000, 'Frequency'), gainDb: gain(filter.gainDb, 'Gain'), q: number(filter.q, .1, 20, 'Q') };
  }) };
}
export function importPreset(text, name) {
  let json;
  if (/^[\s]*[\[{]/.test(text)) json = JSON.parse(text);
  if (json?.format === 'peq-studio' && json.preset) {
    const p = json.preset;
    return { ...newPreset(String(p.name || name)), linked: p.linked !== false, enabled: p.enabled !== false, left: validateChannel(p.left), right: validateChannel(p.linked !== false ? p.left : p.right) };
  }
  const p = json?.hidPeqConfig ?? json?.peq ?? json;
  if (p?.bandsL) {
    const convert = bands => bands.slice(0, p.filterNum ?? bands.length).map(b => ({ ...b, type: typeof b.type === 'number' ? ({ 0: 'PK', 1: 'PK', 2: 'LP', 3: 'HP', 4: 'LSC', 5: 'HSC' }[b.type] ?? 'UNKNOWN') : b.type, fcHz: b.freqHz ?? b.fcHz ?? b.freq }));
    const left = validateChannel({ preampDb: p.preampGainL ?? 0, filters: convert(p.bandsL) });
    const right = validateChannel({ preampDb: p.preampGainR ?? p.preampGainL ?? 0, filters: convert(p.bandsR ?? p.bandsL) });
    return { ...newPreset(name, left), right, linked: JSON.stringify(left) === JSON.stringify(right) };
  }
  // The upstream parser rejects a valid flat, zero-preamp TXT. Handle that case here.
  const normalizedText = text.replace(/Frequency\(Hz\)/gi, 'frequency').replace(/Gain\(dB\)/gi, 'gain').replace(/^Preamp\(dB\):\s*([-+\d.]+)\s*$/gmi, '# Preamp(dB): $1');
  const channel = /^\s*Preamp:\s*0(?:\.0+)?\s*dB\s*$/i.test(text) ? { preampDb: 0, filters: [] } : parseAny(normalizedText.replace(/^# Preamp\(dB\):.*\r?\n/m, ''));
  const csvPreamp = /^Preamp\(dB\):\s*([-+\d.]+)/mi.exec(text);
  if (csvPreamp) channel.preampDb = Number(csvPreamp[1]);
  if (json && !Array.isArray(json) && !Array.isArray(json.filters) && !Array.isArray(p?.bands)) throw Error('No supported PEQ filters found in this JSON.');
  return newPreset(name, validateChannel(channel));
}
export function exportPreset(preset) { return JSON.stringify({ format: 'peq-studio', version: 1, preset }, null, 2); }
export function exportText(channel) { return toRewText(channel); }
export function parseCurve(text, name) {
  const points = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[#*;]/.test(line)) continue;
    const cells = line.trim().split(/[,\t ]+/);
    if (cells.length < 2) continue;
    const [hz, db] = cells.map(Number);
    if (Number.isFinite(hz) && Number.isFinite(db) && hz >= 20 && hz <= 20000 && Math.abs(db) <= 300) points.set(hz, db);
  }
  if (points.size < 2) throw Error('Curve needs at least two frequency / dB rows between 20 Hz and 20 kHz.');
  return { id: crypto.randomUUID(), name, points: [...points].sort((a, b) => a[0] - b[0]) };
}
export function curveValue(curve, hz, normalize = true) { return curve ? interpolate(curve.points, hz) - (normalize ? interpolate(curve.points, 1000) : 0) : 0; }
export function response(channel, hz, sampleRate = 48000) { return calculateCombinedResponseDb(channel.filters, channel.preampDb, hz, { samplingFrequencyHz: sampleRate }); }
export function validateState(state) {
  if (state?.version !== 1 || !Array.isArray(state.presets) || !state.presets.length) throw Error('Invalid saved workspace.');
  state.presets.forEach(p => { validateChannel(p.left); validateChannel(p.right); if (typeof p.name !== 'string') throw Error('Invalid preset name.'); });
  if (!Array.isArray(state.curves)) throw Error('Invalid saved curves.');
  for (const c of state.curves) {
    if (typeof c.id !== 'string' || typeof c.name !== 'string' || /^builtin[:-]/.test(c.id) || (c.kind && !['source','target','both'].includes(c.kind))) throw Error('Invalid custom curve.');
    if (!Array.isArray(c.points) || c.points.length < 2 || c.points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || p[0] < 20 || p[0] > 20000)) throw Error('Invalid curve points.');
    c.points.sort((a,b) => a[0]-b[0]);
  }
  if (![44100,48000,96000,192000].includes(state.sampleRate)) state.sampleRate = 48000;
  if (!state.presets.some(p => p.id === state.activeId)) state.activeId = state.presets[0].id;
  state.curveDisplay=normalizeCurveDisplay(state.curveDisplay);
  try {state.autoEqOptions=validateAutoEqOptions(state.autoEqOptions);}catch{state.autoEqOptions=defaultAutoEqOptions();}
  return state;
}
