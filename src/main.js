import './style.css';
import './curve-picker.css';
import './controls.css';
import './scrollbars.css';
import { TYPES, bandColor, FREQUENCIES, clone, clamp, newBand, newPreset, initialState, validateState, importPreset, exportPreset, exportText, parseCurve, interpolate, response } from './model.js';
import { getTransferFunction, calculateFilterResponseDb } from './response.js';
import { createCurvePicker } from './curve-picker.js';
import { findCurve, removeCustomCurve, loadBuiltinCurve } from './curve-library.js';
import { curveShift } from './curve-level.js';
import { installNumericControls } from './numeric-controls.js';
import { createSettingsPopup } from './settings-popup.js';
import { installPresetReordering } from './preset-reorder.js';
import { createAutoEqPopup } from './autoeq-popup.js';
import { hoverMarkup } from './chart-hover.js';

const KEY = 'peq-studio.workspace.v1';
let state, storageWarning = '';
try { const saved = localStorage.getItem(KEY); state = saved ? validateState(JSON.parse(saved)) : initialState(); }
catch { state = initialState(); storageWarning = 'Saved workspace could not be loaded. Export a backup before closing.'; }
let channel = 'left', selected = -1;
const curveRequests = {target:0,source:0};
let layers = { target: true, source: true, bands: false, combined: true, filtered: true };
let undo = [], redo = [], drag = null, toastTimer, numericEditing = null;
const $ = selector => document.querySelector(selector);
const esc = str => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = hz => hz >= 1000 ? `${+(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
const signed = value => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
const preset = () => state.presets.find(p => p.id === state.activeId);
const current = () => preset()[preset().linked ? 'left' : channel];
const icons = {
 PK: '<path d="M2 17h3c4 0 4-11 7-11s3 11 7 11h3"/>',
 LSC: '<path d="M2 6h5c6 0 4 12 10 12h5"/>',
 HSC: '<path d="M2 18h5c6 0 4-12 10-12h5"/>',
 LP: '<path d="M2 6h6c6 0 7 4 9 10l3 6"/>',
 HP: '<path d="m4 22 3-6c2-6 3-10 9-10h6"/>',
 plus: '<path d="M12 5v14M5 12h14"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
 wave: '<path d="M2 12h4l3-8 6 16 3-8h4"/>', chevron:'<path d="m8 5 7 7-7 7"/>', undo:'<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>', redo:'<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
 copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>', trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>', book:'<path d="M12 5v16M12 5C8 2 3 3 3 3v15s5-1 9 3c4-4 9-3 9-3V3s-5-1-9 2Z"/>', sliders:'<path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>', check:'<path d="m5 12 4 4L19 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.wave}</svg>`;
const ib = (action, name, label, disabled = false) => `<button class="icon-button" data-action="${action}" title="${label}" aria-label="${label}" ${disabled ? 'disabled' : ''}>${icon(name)}</button>`;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); $('#save-status').textContent = 'Saved locally'; }
  catch { $('#save-status').textContent = 'Storage full · export a backup'; toast('Storage full · export a backup'); }
}
function snapshot() { undo.push(JSON.stringify(state)); if (undo.length > 80) undo.shift(); redo = []; }
function commit(fn) { snapshot(); fn(); syncLinked(); save(); render(); }
function syncLinked() { if (preset().linked) preset().right = clone(preset().left); }
function toast(message, action) {
  const element=$('#toast');element.textContent=message;
  if(action){const button=document.createElement('button');button.textContent='Undo';button.onclick=()=>{action();element.classList.remove('visible');};element.append(button);}
  element.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.classList.remove('visible'),action?10000:4000);
}
function history(back) {
  const from = back ? undo : redo, to = back ? redo : undo;
  if (!from.length) return;
  to.push(JSON.stringify(state)); state = JSON.parse(from.pop()); selected = -1; save(); render(); restoreSelectedCurves();
}

$('#app').innerHTML = `
  <main class="workspace"><aside class="sidebar"><div class="sidebar-heading"><div><div class="brand sidebar-brand" aria-label="PEQ Studio">${icon('wave')}<strong>PEQ<span>STUDIO</span></strong></div><h2>Presets <span id="preset-count"></span></h2></div>${ib('new','plus','New preset')}</div><div class="search-wrap"><input id="search" aria-label="Search presets" placeholder="Search presets…"/></div><nav id="presets" aria-label="Local presets"></nav><div class="sidebar-bottom"><span class="local-dot"></span><div><strong id="save-status" role="status">Saved locally</strong><p>No account. No cloud.</p></div>${ib('backup','download','Back up workspace')}</div></aside>
  <section class="editor"><div class="editor-heading"><div class="title-wrap"><span class="eyebrow">PARAMETRIC EQUALIZER</span><button id="preset-name" data-action="rename" title="Rename preset"></button></div><div class="editor-actions"><div class="history">${ib('undo','undo','Undo')}${ib('redo','redo','Redo')}</div><div class="segmented" id="channel-mode"></div><label class="power-label">PEQ <input type="checkbox" id="power" role="switch"/><span class="switch-track"></span></label></div></div>
  <div class="curve-toolbar"><div class="curve-fields"><div id="target-picker"></div><div id="source-picker"></div></div><div class="toolbar-actions"><button data-action="autoeq" title="Fit source response to target">${icon('wave')} Auto EQ</button>${ib('settings','sliders','Display settings')}<button data-action="export">${icon('download')} Export</button><button data-action="import">${icon('upload')} Import</button></div></div>
  <div class="legend-row"><div id="legend"></div><span class="chart-unit">dB / Hz</span></div>
  <div class="graph-area"><div class="chart-controls"><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out">−</button></div><svg id="chart" viewBox="0 0 1200 490" role="img" aria-label="Interactive frequency response chart. Drag a band to change frequency and gain. Double-click to add a band."></svg><div class="graph-footer"><span id="graph-hint">Double-click to add a band · Drag to tune · Scroll a band to adjust Q</span><span id="peak-status"></span></div></div>
  <div class="band-panel"><div class="preamp"><span class="gain-mark">G</span><div><label for="preamp">PREAMP</label><div class="preamp-value"><input type="number" data-adjust="preamp" id="preamp" step="0.1" aria-label="Preamp gain"/><span>dB</span></div><input type="range" data-adjust="preamp" id="preamp-range" min="-24" max="12" step="0.1" aria-label="Preamp gain slider"/></div></div><div class="band-count"><span>BANDS</span><strong id="band-count"></strong></div><div id="bands" class="bands"></div><div class="rail-actions"><button data-action="auto-preamp" title="Reduce preamp until the sampled combined response is at or below 0 dB">Safe gain</button><button data-action="clear" class="subtle">Clear all</button></div></div>
  <div id="band-editor"></div><footer class="editor-footer"><span>20 Hz — 20 kHz <span class="divider">/</span> <span id="sample-rate-label">48 kHz</span></span><span>Filter engine extracted from TOPPING Home <span class="version">v1.14.0</span></span></footer>
  </section></main><div id="toast" role="status"></div><dialog id="modal"><div id="modal-content"></div></dialog><input id="file-input" type="file" hidden/>`;

const curvePickers = ['target','source'].map(kind => createCurvePicker({
  root: $(`#${kind}-picker`), kind, getState: () => state,
  onSelect: async id => {
    const request = ++curveRequests[kind];
    await loadBuiltinCurve(kind,id);
    if (request === curveRequests[kind]) commit(() => { state[`${kind}Id`] = id; });
  },
  onDelete: id => { commit(() => removeCustomCurve(state,id)); toast('Curve removed. Undo is available.'); },
  onImport: () => importCurveFile(kind),
}));

const settingsPopup = createSettingsPopup({anchor:$('[data-action="settings"]'),getState:()=>state,onAlignmentChange:method=>{if(method!==state.curveDisplay.method)commit(()=>{state.curveDisplay.method=method;});}});
function autoEqSignature(){return JSON.stringify({preset:preset(),channel,sourceId:state.sourceId,targetId:state.targetId,sampleRate:state.sampleRate,display:state.curveDisplay});}
const autoEqPopup=createAutoEqPopup({
  anchor:$('[data-action="autoeq"]'),
  getOptions:()=>state.autoEqOptions,
  onOptionsChange:options=>{if(JSON.stringify(state.autoEqOptions)!==JSON.stringify(options)){state.autoEqOptions=options;save();}},
  getContext:()=>{
    const source=findCurve(state,'source'),target=findCurve(state,'target');
    if(!source||!target)throw Error('Choose a source and target curve first.');
    if(!source.points||!target.points)throw Error('Curve data is still loading. Please try again.');
    return {source:clone(source),target:clone(target),display:clone(state.curveDisplay),sampleRate:state.sampleRate,signature:autoEqSignature(),scope:preset().linked?'both linked channels':`${channel} channel`};
  },
  onApply:(result,context)=>{
    if(context.signature!==autoEqSignature())throw Error('The preset or curves changed while fitting. Generate again to use the new settings.');
    commit(()=>{current().filters=result.filters;current().preampDb=result.preampDb;preset().enabled=true;selected=result.filters.length?0:-1;});
    toast(`Auto EQ: ${result.filters.length} bands · fit error ${result.fit.before.toFixed(2)} → ${result.fit.after.toFixed(2)} dB. Undo available.`);
  },
});

function renderPresets() {
  const search = $('#search').value.toLowerCase();
  $('#preset-count').textContent = state.presets.length;
  $('#presets').innerHTML = state.presets.filter(p => p.name.toLowerCase().includes(search)).map(p => `<div class="preset-row ${p.id === state.activeId ? 'active' : ''}" data-preset-id="${esc(p.id)}"><button class="preset-grip" data-reorder="${esc(p.id)}" aria-label="Reorder ${esc(p.name)}" title="Drag to reorder · arrow keys to move">⠿</button><button class="preset-select" data-id="${esc(p.id)}"><span>${esc(p.name)}</span></button><button class="preset-copy icon-button" data-copy-preset="${esc(p.id)}" aria-label="Duplicate ${esc(p.name)}" title="Duplicate preset">${icon('copy')}</button><button class="preset-delete icon-button" data-delete-preset="${esc(p.id)}" aria-label="Delete ${esc(p.name)}" title="Delete preset">${icon('trash')}</button></div>`).join('') || '<p class="empty">No matching presets</p>';
}
function deletePreset(id){
  const index=state.presets.findIndex(p=>p.id===id);if(index<0)return;
  const removed=clone(state.presets[index]),nextId=state.presets[index+1]?.id;
  const wasActive=state.activeId===id;let replacement=null;
  commit(()=>{state.presets.splice(index,1);if(!state.presets.length){replacement=newPreset();state.presets.push(replacement);}if(wasActive){state.activeId=state.presets[Math.min(index,state.presets.length-1)].id;selected=-1;}});
  toast(`Deleted “${removed.name}”`,()=>{
    if(state.presets.some(p=>p.id===id))return;
    commit(()=>{if(replacement&&JSON.stringify(state.presets.find(p=>p.id===replacement.id))===JSON.stringify(replacement))state.presets=state.presets.filter(p=>p.id!==replacement.id);
      const nextIndex=state.presets.findIndex(p=>p.id===nextId);state.presets.splice(nextIndex<0?Math.min(index,state.presets.length):nextIndex,0,removed);
      if(wasActive){state.activeId=id;selected=-1;}
    });
  });
}
installPresetReordering($('#presets'),(id,targetId,after)=>{
  const ids=state.presets.map(p=>p.id),from=ids.indexOf(id);if(from<0||id===targetId)return;
  ids.splice(from,1);const to=ids.indexOf(targetId);if(to<0)return;ids.splice(to+(after?1:0),0,id);
  if(ids.every((value,i)=>value===state.presets[i].id))return;
  commit(()=>{const byId=new Map(state.presets.map(p=>[p.id,p]));state.presets=ids.map(value=>byId.get(value));});
});
function render() {
  const p = preset(), c = current();
  if (selected >= c.filters.length) selected = -1;
  renderPresets();
  $('#preset-name').innerHTML = `${esc(p.name)}<span class="rename-icon">↗</span>`;
  $('[data-action="undo"]').disabled = !undo.length; $('[data-action="redo"]').disabled = !redo.length;
  $('#channel-mode').innerHTML = `<button data-action="link" class="${p.linked ? 'active' : ''}" aria-pressed="${p.linked}">L+R</button><button data-action="split" class="${!p.linked ? 'active' : ''}" aria-pressed="${!p.linked}">L/R</button>${!p.linked ? `<button data-action="left" class="${channel === 'left' ? 'active' : ''}">L</button><button data-action="right" class="${channel === 'right' ? 'active' : ''}">R</button>` : ''}`;
  $('#power').checked = p.enabled;
  curvePickers.forEach(picker => picker.update());
  settingsPopup.update();
  autoEqPopup.update();
  const labels = { target: 'Target', source: 'Source response', bands: 'Each filter', combined: 'Combined filter', filtered: 'Filtered response' };
  $('#legend').innerHTML = Object.entries(labels).map(([key,label]) => `<button data-layer="${key}" class="legend-chip ${key} ${layers[key] ? 'on' : ''}" aria-pressed="${layers[key]}"><i></i>${label}</button>`).join('');
  $('#preamp').value = +c.preampDb.toFixed(1); $('#preamp-range').min=Math.min(-24,c.preampDb); $('#preamp-range').max=Math.max(12,c.preampDb); $('#preamp-range').value = c.preampDb;
  $('#band-count').textContent = c.filters.length;
  $('#bands').innerHTML = c.filters.map((f,i) => `<div class="band-card ${selected === i ? 'selected' : ''} ${!f.enabled ? 'disabled-band' : ''}" style="--band:${bandColor(i)}"><button class="band-toggle" data-toggle="${i}" aria-label="${f.enabled ? 'Disable' : 'Enable'} band ${i+1}" title="${TYPES[f.type] || f.type}">${icon(f.type)}<span>${f.enabled ? String(i+1).padStart(2,'0') : 'OFF'}</span></button><button class="band-detail" data-band="${i}" aria-label="Edit band ${i+1}"><span data-adjust="frequency" data-band-index="${i}" title="Frequency · drag up/down or scroll"><em>F</em><b class="number-value">${fmt(f.fcHz)}</b></span><span data-adjust="gain" data-band-index="${i}" title="Gain · drag up/down or scroll"><em>G</em><b class="number-value ${f.gainDb < 0 ? 'negative' : ''}">${signed(f.gainDb)}</b></span><span data-adjust="q" data-band-index="${i}" title="Q · drag up/down or scroll"><em>Q</em><b class="number-value">${+f.q.toFixed(2)}</b></span></button><button class="band-remove" data-remove="${i}" aria-label="Remove band ${i+1}">×</button></div>`).join('') + `<button class="add-band" data-action="add" aria-label="Add band" >${icon('plus')}</button>`;
  renderBandEditor(); draw();
  $('#sample-rate-label').textContent = `${state.sampleRate / 1000} kHz`;
}
function renderBandEditor() {
  const f = current().filters[selected];
  $('#band-editor').innerHTML = !f ? '<div class="editor-empty">Select a band to edit its frequency, gain, and Q.</div>' : `<div class="detail-panel"><span class="detail-number" style="color:${bandColor(selected)}">BAND ${String(selected+1).padStart(2,'0')}</span><label>FILTER TYPE<select id="filter-type">${Object.entries(TYPES).map(([code,name]) => `<option value="${code}" ${f.type === code ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>FREQUENCY <div class="unit-input"><input id="frequency" data-adjust="frequency" type="number" min="20" max="20000" step="1" value="${+f.fcHz.toFixed(1)}"/>Hz</div></label><label>GAIN<div class="unit-input"><input id="gain" data-adjust="gain" type="number" step="0.1" value="${+f.gainDb.toFixed(1)}" ${['LP','HP'].includes(f.type) ? 'disabled' : ''}/>dB</div></label><label>Q FACTOR<div class="unit-input"><input id="q" data-adjust="q" type="number" min="0.1" max="20" step="0.05" value="${+f.q.toFixed(4)}"/></div></label>${ib('close-band','close','Close band editor')}</div>`;
}

const bounds = { l: 54, r: 1175, t: 24, b: 447 };
const xOf = hz => bounds.l + Math.log10(hz / 20) / 3 * (bounds.r-bounds.l);
let axisMin = -state.curveDisplay.rangeDb, axisMax = state.curveDisplay.rangeDb;
const yOf = db => bounds.t + (axisMax-db)/(axisMax-axisMin)*(bounds.b-bounds.t);
let hoverPoint = null, hoverFrame = 0, hoverReadings = () => [];
function drawHover() {
  const overlay = $('#chart-hover');
  if(!overlay)return;
  overlay.innerHTML = hoverPoint ? hoverMarkup({point:hoverPoint,...values(hoverPoint),readings:hoverReadings(values(hoverPoint).hz),bounds,yOf}) : '';
}
function clearHover(){hoverPoint=null;drawHover();}
function draw() {
  const c = current(), enabled = preset().enabled;
  const targetItem = findCurve(state, 'target'), sourceItem = findCurve(state, 'source');
  const target = targetItem?.points ? targetItem : null, source = sourceItem?.points ? sourceItem : null;
  const display=state.curveDisplay, compensated=display.compensated, range=display.rangeDb;
  const targetShift=curveShift(target,'target',display),sourceShift=curveShift(source,'source',display);
  const targetValue=hz=>target?interpolate(target.points,hz)+targetShift:0;
  const sourceValue=hz=>source?interpolate(source.points,hz)+sourceShift:0;
  const reference=display.method==='none'?0:display.referenceDb;
  axisMin=Math.min(-range,compensated?-range:reference-range);
  axisMax=Math.max(range,compensated?range:reference+range);
  if(display.method==='none'&&!compensated)for(const [item,shift] of [[target,targetShift],[source,sourceShift]])if(item){
    const center=interpolate(item.points,1000)+shift;axisMin=Math.min(axisMin,center-range);axisMax=Math.max(axisMax,center+range);
  }
  const curve = (fn) => FREQUENCIES.map((hz,i) => `${i ? 'L' : 'M'}${xOf(hz).toFixed(2)},${yOf(fn(hz,i)).toFixed(2)}`).join(' ');
  const offset = hz => compensated && target ? targetValue(hz) : 0;
  const sampling={samplingFrequencyHz:state.sampleRate};
  const transfers=enabled?c.filters.filter(f=>f.enabled).map(f=>getTransferFunction(f.type,f.fcHz,f.gainDb,f.q,sampling)):[];
  const combined=FREQUENCIES.map(hz=>enabled?transfers.reduce((sum,tf)=>sum+calculateFilterResponseDb(tf,hz,sampling),c.preampDb):0);
  let html = '<defs><clipPath id="plot-clip"><rect x="54" y="24" width="1121" height="423"/></clipPath><linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f5a338" stop-opacity="0.075"/><stop offset="1" stop-color="#f5a338" stop-opacity="0"/></linearGradient></defs>';
  const major = [20,50,100,200,500,1000,2000,5000,10000,20000];
  const decades = [100,1000,10000];
  for (const hz of [20,30,40,50,60,70,80,90,100,200,300,400,500,600,700,800,900,1000,2000,3000,4000,5000,6000,7000,8000,9000,10000,20000]) html += `<line x1="${xOf(hz)}" y1="24" x2="${xOf(hz)}" y2="447" class="grid ${major.includes(hz) ? 'major' : ''} ${decades.includes(hz) ? 'decade' : ''}"/>`;
  const step = axisMax-axisMin <= 30 ? 5 : axisMax-axisMin>100?20:10;
  for (let db = Math.ceil(axisMin/step)*step; db <= axisMax; db += step) html += `<line x1="54" x2="1175" y1="${yOf(db)}" y2="${yOf(db)}" class="${db === 0 ? 'zero-line' : 'grid major'}"/><text x="42" y="${yOf(db)+4}" text-anchor="end" class="axis">${db > 0 ? '+' : ''}${db}</text>`;
  for (const hz of major) html += `<text x="${xOf(hz)}" y="475" text-anchor="middle" class="axis ${decades.includes(hz) ? 'decade' : ''}">${fmt(hz)}</text>`;
  html += '<g clip-path="url(#plot-clip)">';
  if (layers.bands && enabled) c.filters.forEach((f,i) => { if (f.enabled) { const tf = getTransferFunction(f.type,f.fcHz,f.gainDb,f.q,{samplingFrequencyHz:state.sampleRate}); html += `<path d="${curve(hz=>calculateFilterResponseDb(tf,hz,{samplingFrequencyHz:state.sampleRate}))}" fill="none" stroke="${bandColor(i)}" stroke-opacity=".45" stroke-width="1.3"/>`; } });
  if (layers.target && target) html += `<path class="response-path target-path" d="${curve(hz=>targetValue(hz)-offset(hz))}"/>`;
  if (layers.source && source) html += `<path class="response-path source-path" d="${curve(hz=>sourceValue(hz)-offset(hz))}"/>`;
  if (layers.combined) html += `<path class="response-path combined-path" d="${curve((hz,i)=>combined[i])}"/>`;
  const filteredPreampAdjustment=enabled&&!display.includePreamp?c.preampDb:0;
  if (layers.filtered && source) html += `<path class="response-path filtered-path" d="${curve((hz,i)=>sourceValue(hz)+combined[i]-filteredPreampAdjustment-offset(hz))}"/>`;
  c.filters.forEach((f,i) => { if (f.enabled) html += `<g data-point="${i}" class="control-point" role="button" tabindex="0" aria-label="Band ${i+1}: ${Math.round(f.fcHz)} Hz, ${signed(f.gainDb)} dB. Arrow keys adjust; Shift makes larger steps."><circle cx="${xOf(f.fcHz)}" cy="${yOf(f.gainDb)}" r="17" fill="transparent"/><circle cx="${xOf(f.fcHz)}" cy="${yOf(f.gainDb)}" r="${i === selected ? 7 : 5.5}" fill="${bandColor(i)}" stroke="#f8fafc" stroke-width="2"/>${i===selected ? `<circle cx="${xOf(f.fcHz)}" cy="${yOf(f.gainDb)}" r="12" stroke="${bandColor(i)}" stroke-opacity=".45" fill="none"/>` : ''}</g>`; });
  html += '</g>';
  if (!enabled) html += '<text x="614" y="55" text-anchor="middle" class="bypass-label">PEQ BYPASSED</text>';
  hoverReadings = hz => {
    const total = enabled ? transfers.reduce((sum,tf)=>sum+calculateFilterResponseDb(tf,hz,sampling),c.preampDb) : 0;
    const readings=[];
    if(layers.target&&target)readings.push({name:'Target',color:'#548eff',db:targetValue(hz)-offset(hz)});
    if(layers.source&&source)readings.push({name:'Source',color:'#dc6576',db:sourceValue(hz)-offset(hz)});
    if(layers.combined)readings.push({name:'Combined',color:'#f5a338',db:total});
    if(layers.filtered&&source)readings.push({name:'Filtered',color:'#40c6b9',db:sourceValue(hz)+total-filteredPreampAdjustment-offset(hz)});
    const f=c.filters[selected];
    if(layers.bands&&enabled&&f?.enabled)readings.push({name:`Band ${selected+1}`,color:bandColor(selected),db:calculateFilterResponseDb(getTransferFunction(f.type,f.fcHz,f.gainDb,f.q,sampling),hz,sampling)});
    return readings;
  };
  $('#chart').innerHTML = html+'<g id="chart-hover" aria-hidden="true" pointer-events="none"></g>';
  drawHover();
  const peak = Math.max(...combined);
  $('#peak-status').textContent = peak > .05 ? `Peak ${signed(peak)} dB · consider Safe gain` : `${enabled ? 'Peak' : 'Bypass'} ${signed(peak)} dB`;
  $('#peak-status').className = peak > .05 ? 'warning' : '';
}
function addBand(hz = 1000, db = 0) {
  commit(() => { current().filters.push(newBand(Math.round(hz), +db.toFixed(1))); selected = current().filters.length-1; });
}
function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileName = () => preset().name.replace(/[<>:"/\\|?*]/g,'_');
function openModal(title, content) {
  $('#modal-content').innerHTML = `<div class="modal-heading"><h2>${title}</h2>${ib('close-modal','close','Close dialog')}</div>${content}`;
  $('#modal').showModal();
}
function chooseFile(accept, handler) {
  const input = $('#file-input'); input.value = ''; input.accept = accept;
  input.onchange = async () => { const file = input.files[0]; if (!file) return; try { if (file.size > 10*1024*1024) throw Error('Choose a file smaller than 10 MB.'); await handler(await file.text(), file.name.replace(/\.[^.]+$/,''), file.name); } catch(e) { toast(e.message); } };
  input.click();
}
function importCurveFile(kind) {
  chooseFile('.csv,.txt,.tsv', (text,name,fileName) => {
    const curve={...parseCurve(text,fileName || name),kind:'both'};
    commit(() => { state.curves.push(curve); state[`${kind}Id`]=curve.id; });
    if ($('#modal').open) $('#modal').close();
    toast(`Added ${curve.name}`);
  });
}
const actions = {
  new: () => commit(() => { const p = newPreset(`Local preset ${state.presets.length+1}`); state.presets.push(p); state.activeId=p.id; selected=-1; }),
  duplicate: () => commit(() => { const p = clone(preset()); p.id=crypto.randomUUID(); p.name += ' · copy'; state.presets.push(p); state.activeId=p.id; selected=-1; }),
  rename: () => startRename(),
  'delete-preset': () => { $('#modal').close(); deletePreset(state.activeId); },
  undo: () => history(true), redo: () => history(false),
  link: () => { if (preset().linked) return; openModal('Link left and right', `<p>The ${channel} channel will be copied to both channels. You can undo this change.</p><div class="modal-actions"><button data-action="close-modal">Cancel</button><button class="primary" data-action="confirm-link">Use ${channel} for both</button></div>`); },
  'confirm-link': () => { $('#modal').close(); commit(() => { const c=clone(current()); preset().left=c; preset().linked=true; channel='left'; }); },
  split: () => { if (preset().linked) commit(() => { preset().linked=false; channel='left'; }); },
  left: () => { channel='left'; selected=-1; render(); }, right: () => { channel='right'; selected=-1; render(); },
  add: () => addBand(), 'close-band': () => { selected=-1; render(); },
  clear: () => { if (!current().filters.length) return; commit(() => { current().filters=[]; selected=-1; }); toast('Bands cleared for the active channel. Undo is available.'); },
  'auto-preamp': () => { const c=current(); const max=Math.max(...FREQUENCIES.map(hz=>response({...c,preampDb:0},hz,state.sampleRate))); commit(() => { current().preampDb=-Math.ceil(Math.max(0,max)*10)/10; }); },
  'zoom-in': () => { if(state.curveDisplay.rangeDb>5)commit(()=>{state.curveDisplay.rangeDb=Math.max(5,state.curveDisplay.rangeDb-5);}); },
  'zoom-out': () => commit(()=>{state.curveDisplay.rangeDb+=5;}),
  export: () => openModal('Export preset', `<p>Equalizer APO configuration for ${preset().linked ? 'both linked channels' : `the ${channel} channel`}. Copy it below or download a file.</p><label class="config-label" for="export-text">APO configuration</label><textarea id="export-text" class="config-text" rows="10" readonly spellcheck="false" aria-label="APO configuration">${esc(exportText(current()))}</textarea><div class="config-copy-row"><span id="copy-status" role="status"></span><button class="primary" data-action="copy-apo">${icon('copy')} Copy configuration</button></div><div class="export-options"><button data-action="export-txt">${icon('download')} Filter settings <small>Equalizer APO / REW · .txt</small></button><button data-action="export-json">${icon('download')} Complete preset <small>Left + right channels · .json</small></button></div>`),
  'copy-apo': async () => {
    const field=$('#export-text'),status=$('#copy-status');
    try { await navigator.clipboard.writeText(field.value); status.textContent='Copied'; }
    catch { field.focus();field.select();status.textContent='Press Ctrl+C to copy the selected configuration.'; }
  },
  'export-txt': () => { download(`${fileName()}-${preset().linked ? 'LR' : channel}.txt`,exportText(current())); $('#modal').close(); },
  'export-json': () => { download(`${fileName()}.json`,exportPreset(preset()),'application/json'); $('#modal').close(); },
  import: () => openModal('Import preset', `<p>Paste an Equalizer APO configuration below. Import creates a new local preset.</p><label class="config-label" for="import-text">APO configuration</label><textarea id="import-text" class="config-text" rows="10" spellcheck="false" aria-label="APO configuration to import" placeholder="Preamp: -5.5 dB&#10;Filter 1: ON PK Fc 1200 Hz Gain 5.4 dB Q 1.5"></textarea><p class="form-error" id="import-error" role="alert"></p><div class="modal-actions"><button class="primary" data-action="import-paste">Import as new preset</button></div><div class="or-divider">or import a file</div><button data-action="import-file" class="wide">${icon('upload')} Choose a file</button><p class="small-text">TOPPING / REW / Equalizer APO TXT, filter CSV, or PEQ JSON.</p>`),
  'import-file': () => chooseFile('.txt,.json,.csv', (text,name) => doImport(text,name)),
  'import-paste': () => { try { doImport($('#import-text').value,'Imported preset'); } catch(e) { $('#import-error').textContent=e.message; } },
  settings: () => { autoEqPopup.close(); settingsPopup.toggle(); },
  autoeq: () => { settingsPopup.close(); autoEqPopup.toggle(); },
  backup: () => openModal('Workspace backup', '<p>Back up all presets, both channels, and imported response curves.</p><div class="export-options"><button data-action="backup-save">Download backup<small>All workspace data · JSON</small></button><button data-action="backup-restore">Restore backup<small>Replaces this workspace · undo available</small></button></div>'),
  'backup-save': () => { download('peq-workspace.json',JSON.stringify(state,null,2),'application/json'); $('#modal').close(); },
  'backup-restore': () => chooseFile('.json', text=>{const restored=validateState(JSON.parse(text)); commit(()=>{state=restored;selected=-1;});restoreSelectedCurves();$('#modal').close();toast('Workspace restored.');}),
  'close-modal': () => $('#modal').close(),
};
function doImport(text,name) { const p=importPreset(text,name); commit(()=>{state.presets.push(p);state.activeId=p.id;selected=-1;});$('#modal').close();toast(`Imported ${p.name}`); }

document.addEventListener('click', event => {
  const removePreset=event.target.closest('[data-delete-preset]');if(removePreset)return deletePreset(removePreset.dataset.deletePreset);
  const copyPreset=event.target.closest('[data-copy-preset]');if(copyPreset)return commit(()=>{const p=clone(state.presets.find(p=>p.id===copyPreset.dataset.copyPreset));p.id=crypto.randomUUID();p.name+=' · copy';state.presets.push(p);state.activeId=p.id;selected=-1;});
  const action=event.target.closest('[data-action]'); if(action) return actions[action.dataset.action]?.();
  const row=event.target.closest('[data-id]'); if(row) { state.activeId=row.dataset.id; selected=-1; channel='left'; save(); render(); return; }
  const band=event.target.closest('[data-band]'); if(band) {selected=+band.dataset.band;render();return;}
  const toggle=event.target.closest('[data-toggle]'); if(toggle) {commit(()=>{const f=current().filters[+toggle.dataset.toggle];f.enabled=!f.enabled;});return;}
  const remove=event.target.closest('[data-remove]'); if(remove) {commit(()=>{current().filters.splice(+remove.dataset.remove,1);selected=-1;});return;}
  const layer=event.target.closest('[data-layer]'); if(layer) {layers[layer.dataset.layer]=!layers[layer.dataset.layer];render();}
});
let renamingId=null;
const renameInput=document.createElement('input');renameInput.id='rename-input';renameInput.maxLength=100;renameInput.hidden=true;renameInput.setAttribute('aria-label','Preset name');renameInput.title='Enter to save · Escape to cancel';$('#preset-name').after(renameInput);
function startRename(){renamingId=state.activeId;renameInput.value=preset().name;$('#preset-name').hidden=true;renameInput.hidden=false;renameInput.focus();renameInput.select();}
function finishRename(cancel=false){
  if(!renamingId)return;const id=renamingId,name=renameInput.value.trim();renamingId=null;renameInput.hidden=true;$('#preset-name').hidden=false;
  const p=state.presets.find(p=>p.id===id);if(!cancel&&p&&name&&name!==p.name)commit(()=>{p.name=name;});
}
renameInput.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopPropagation();finishRename(event.key==='Escape');$('#preset-name').focus();}});
renameInput.addEventListener('blur',()=>finishRename());
$('#search').addEventListener('input',renderPresets);
const numericFields={frequency:['fcHz',20,20000,1,true],gain:['gainDb',-Infinity,Infinity,.1],q:['q',.1,20,.05]};
const displayFields={'target-offset':['targetOffsetDb',-120,120,.1],'source-offset':['sourceOffsetDb',-120,120,.1],'reference-level':['referenceDb',-60,120,.1],'level-min':['minHz',20,19999,1,true],'level-max':['maxHz',21,20000,1,true]};
function getNumericControl(el){
  const name=el.dataset.adjust;
  if(name==='preamp')return{key:'preamp',name,element:el,value:current().preampDb,min:-Infinity,max:Infinity,step:.1};
  if(displayFields[name]){
    const [property,min,max,step,log]=displayFields[name];
    return{key:name,name,element:el,property,value:state.curveDisplay[property],min:name==='level-max'?state.curveDisplay.minHz+1:min,max:name==='level-min'?state.curveDisplay.maxHz-1:max,step,log};
  }
  const index=el.dataset.bandIndex===undefined?selected:Number(el.dataset.bandIndex),filter=current().filters[index];
  if(!filter||!numericFields[name]||(name==='gain'&&['LP','HP'].includes(filter.type)))return null;
  const [property,min,max,step,log]=numericFields[name];
  return{key:name+':'+index,name,element:el,property,index,value:filter[property],min,max,step,log};
}
function refreshNumericValues(typingElement=null){
  document.querySelectorAll('[data-adjust]').forEach(el=>{
    const spec=getNumericControl(el);if(!spec)return;
    if(el.matches('input')){if(el.type==='range'){el.min=Math.min(-24,spec.value);el.max=Math.max(12,spec.value);}if(el!==typingElement)el.value=+spec.value.toFixed(4);}
    else {const value=el.querySelector('.number-value');if(value){value.textContent=spec.name==='frequency'?fmt(spec.value):spec.name==='gain'?signed(spec.value):+spec.value.toFixed(2);value.classList.toggle('negative',spec.name==='gain'&&spec.value<0);}}
  });
  document.querySelectorAll('.band-card').forEach((el,i)=>el.classList.toggle('selected',i===selected));
  $('[data-action="undo"]').disabled=!undo.length;$('[data-action="redo"]').disabled=!redo.length;
}
function applyNumeric(spec,value,typingElement=null){
  value=clamp(value,spec.min,spec.max);
  if(spec.name==='preamp')current().preampDb=value;
  else if(displayFields[spec.name])state.curveDisplay[spec.property]=value;
  else {current().filters[spec.index][spec.property]=value;if(selected!==spec.index){selected=spec.index;renderBandEditor();}}
  syncLinked();refreshNumericValues(typingElement);draw();settingsPopup.update();
}
installNumericControls({getControl:getNumericControl,onBegin:()=>{numericEditing=null;snapshot();},onChange:applyNumeric,onEnd:save});
document.addEventListener('input',event=>{
  const el=event.target;if(!el.matches('input[data-adjust]'))return;
  const spec=getNumericControl(el),n=Number(el.value);if(!spec||el.value===''||!Number.isFinite(n))return;
  if(numericEditing!==el.id){snapshot();numericEditing=el.id;}
  applyNumeric(spec,n,el);save();
});
document.addEventListener('focusout',event=>{
  if(event.target.id===numericEditing){numericEditing=null;refreshNumericValues();}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='power') commit(()=>{preset().enabled=el.checked;});
  if(el.matches('input[data-adjust]')){refreshNumericValues();save();}
  if(el.id==='filter-type')commit(()=>{current().filters[selected].type=el.value;});
  if(el.id==='sample-rate'){commit(()=>{state.sampleRate=+el.value;});}
  if(el.id==='compensated')commit(()=>{state.curveDisplay.compensated=el.checked;});
  if(el.id==='include-preamp')commit(()=>{state.curveDisplay.includePreamp=el.checked;});
});
function position(event) {const p=$('#chart').createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform($('#chart').getScreenCTM().inverse());}
function values(p) {return {hz:20*1000**clamp((p.x-bounds.l)/(bounds.r-bounds.l),0,1),db:axisMax-(p.y-bounds.t)/(bounds.b-bounds.t)*(axisMax-axisMin)};}
$('#chart').addEventListener('dblclick',event=>{if(event.target.closest('[data-point]'))return;const p=position(event);if(p.x<bounds.l||p.x>bounds.r||p.y<bounds.t||p.y>bounds.b)return;const v=values(p);addBand(v.hz,v.db);});
$('#chart').addEventListener('pointerdown',event=>{const point=event.target.closest('[data-point]');if(!point)return;event.preventDefault();selected=+point.dataset.point;snapshot();drag={id:event.pointerId,index:selected};$('#chart').setPointerCapture(event.pointerId);renderBandEditor();refreshNumericValues();draw();});
$('#chart').addEventListener('pointermove',event=>{
  const p=position(event);
  hoverPoint=event.pointerType!=='touch'&&p.x>=bounds.l&&p.x<=bounds.r&&p.y>=bounds.t&&p.y<=bounds.b?p:null;
  if(drag&&drag.id===event.pointerId){const v=values(p),f=current().filters[drag.index];f.fcHz=Math.round(v.hz);if(!['LP','HP'].includes(f.type))f.gainDb=+v.db.toFixed(1);syncLinked();refreshNumericValues();draw();}
  else if(!hoverFrame)hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;drawHover();});
});
$('#chart').addEventListener('pointerleave',clearHover);
window.addEventListener('blur',clearHover);
function endDrag(){if(!drag)return;drag=null;save();render();}
$('#chart').addEventListener('pointerup',endDrag);$('#chart').addEventListener('pointercancel',endDrag);
$('#chart').addEventListener('wheel',event=>{const point=event.target.closest('[data-point]');if(!point)return;event.preventDefault();selected=+point.dataset.point;commit(()=>{const f=current().filters[selected];f.q=+clamp(f.q+(event.deltaY<0?.05:-.05),.1,20).toFixed(2);});},{passive:false});
$('#chart').addEventListener('keydown',event=>{const point=event.target.closest('[data-point]');if(!point||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();selected=+point.dataset.point;const n=selected;commit(()=>{const f=current().filters[n],step=event.shiftKey?1:.1;if(event.key==='ArrowUp'||event.key==='ArrowDown'){if(!['LP','HP'].includes(f.type))f.gainDb=+(f.gainDb+(event.key==='ArrowUp'?step:-step)).toFixed(1);}else f.fcHz=Math.round(clamp(f.fcHz*(event.key==='ArrowRight'?(event.shiftKey?1.1:1.01):(event.shiftKey?1/1.1:1/1.01)),20,20000));});$(`[data-point="${n}"]`)?.focus();});
document.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select')||$('#modal').open)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();history(!event.shiftKey);}});
render(); if(storageWarning)toast(storageWarning);
async function restoreSelectedCurves(){
  await Promise.all(['target','source'].map(async kind=>{
    const id=state[`${kind}Id`];
    if(typeof id!=='string'||!id.startsWith('builtin-source:'))return;
    try {await loadBuiltinCurve(kind,id);if(state[`${kind}Id`]===id){draw();settingsPopup.update();autoEqPopup.update();}}
    catch(error){toast(error.message);}
  }));
}
restoreSelectedCurves();
