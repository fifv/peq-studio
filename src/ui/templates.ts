import type { Channel, Filter, Workspace, Preset, ChannelName } from '../types.ts';
import { escapeHtml as esc, formatFrequency as fmt, signed } from '../utils.ts';
import { TYPES, bandColor } from '../model.ts';
import { icon, iconButton as ib } from './icons.ts';
export function appMarkup() {
  return /* HTML */ ` <main class="workspace">
      <aside class="sidebar">
        <div class="sidebar-heading">
          <div>
            <div class="brand sidebar-brand" aria-label="PEQ Studio">
              ${icon('wave')}<strong>PEQ<span>STUDIO</span></strong>
            </div>
            <h2>Presets <span id="preset-count"></span></h2>
          </div>
          ${ib('new', 'plus', 'New preset')}
        </div>
        <div class="search-wrap">
          <input id="search" aria-label="Search presets" placeholder="Search presets…" />
        </div>
        <nav id="presets" aria-label="Local presets"></nav>
        <div class="sidebar-bottom">
          <span class="local-dot"></span>
          <div>
            <strong id="save-status" role="status">Saved locally</strong>
            <p>No account. No cloud.</p>
          </div>
          ${ib('backup', 'download', 'Back up workspace')}
        </div>
      </aside>
      <section class="editor">
        <div class="editor-heading">
          <div class="title-wrap">
            <span class="eyebrow">PARAMETRIC EQUALIZER</span
            ><button id="preset-name" data-action="rename" title="Rename preset"></button>
          </div>
          <div class="editor-actions">
            <div class="history">${ib('undo', 'undo', 'Undo')}${ib('redo', 'redo', 'Redo')}</div>
            <div class="segmented" id="channel-mode"></div>
            <label class="power-label"
              >PEQ <input type="checkbox" id="power" role="switch" /><span
                class="switch-track"
              ></span
            ></label>
          </div>
        </div>
        <div class="curve-toolbar">
          <div class="curve-fields">
            <div id="target-picker"></div>
            <div id="source-picker"></div>
          </div>
          <div class="toolbar-actions">
            <button data-action="autoeq" title="Fit source response to target">
              ${icon('wave')} Auto EQ</button
            >${ib('settings', 'sliders', 'Display settings')}<button data-action="export">
              ${icon('download')} Export</button
            ><button data-action="import">${icon('upload')} Import</button>
          </div>
        </div>
        <div class="legend-row">
          <div id="legend"></div>
          <span class="chart-unit">dB / Hz</span>
        </div>
        <div class="graph-area">
          <div class="chart-controls">
            <button data-action="zoom-in" aria-label="Zoom in">+</button
            ><button data-action="zoom-out" aria-label="Zoom out">−</button>
          </div>
          <svg
            id="chart"
            viewBox="0 0 1200 490"
            role="img"
            aria-label="Interactive frequency response chart. Drag a band to change frequency and gain. Double-click to add a band."
          ></svg>
          <div class="graph-footer">
            <span id="graph-hint"
              >Double-click to add a band · Drag to tune · Scroll a band to adjust Q</span
            ><span id="peak-status"></span>
          </div>
        </div>
        <div class="band-panel">
          <div class="preamp">
            <span class="gain-mark">G</span>
            <div>
              <label for="preamp">PREAMP</label>
              <div class="preamp-value">
                <input
                  type="number"
                  data-adjust="preamp"
                  id="preamp"
                  step="0.1"
                  aria-label="Preamp gain"
                /><span>dB</span>
              </div>
              <input
                type="range"
                data-adjust="preamp"
                id="preamp-range"
                min="-24"
                max="12"
                step="0.1"
                aria-label="Preamp gain slider"
              />
            </div>
          </div>
          <div class="band-count"><span>BANDS</span><strong id="band-count"></strong></div>
          <div id="bands" class="bands"></div>
          <div class="rail-actions">
            <button
              data-action="auto-preamp"
              title="Reduce preamp until the sampled combined response is at or below 0 dB"
            >
              Safe gain</button
            ><button data-action="clear" class="subtle">Clear all</button>
          </div>
        </div>
        <div id="band-editor"></div>
        <footer class="editor-footer">
          <span
            >20 Hz — 20 kHz <span class="divider">/</span>
            <span id="sample-rate-label">48 kHz</span></span
          ><span
            >Filter engine extracted from TOPPING Home <span class="version">v1.14.0</span></span
          >
        </footer>
      </section>
    </main>
    <div id="toast" role="status"></div>
    <dialog id="modal"><div id="modal-content"></div></dialog>
    <input id="file-input" type="file" hidden />`;
}
export function bandCards(c: Channel, selected: number) {
  return (
    c.filters
      .map(
        (f, i) =>
          /* HTML */ ` <div
            class="band-card ${selected === i ? 'selected' : ''} ${!f.enabled ? 'disabled-band' : ''}"
            style="--band:${bandColor(i)}"
          >
            <button
              class="band-toggle"
              data-toggle="${i}"
              aria-label="${f.enabled ? 'Disable' : 'Enable'} band ${i + 1}"
              title="${TYPES[f.type] || f.type}"
            >
              ${icon(f.type)}<span
                >${f.enabled ? String(i + 1).padStart(2, '0') : 'OFF'}</span
              ></button
            ><button class="band-detail" data-band="${i}" aria-label="Edit band ${i + 1}">
              <span
                data-adjust="frequency"
                data-band-index="${i}"
                title="Frequency · drag up/down or scroll"
                ><em>F</em><b class="number-value">${fmt(f.fcHz)}</b></span
              ><span data-adjust="gain" data-band-index="${i}" title="Gain · drag up/down or scroll"
                ><em>G</em
                ><b class="number-value ${f.gainDb < 0 ? 'negative' : ''}"
                  >${signed(f.gainDb)}</b
                ></span
              ><span data-adjust="q" data-band-index="${i}" title="Q · drag up/down or scroll"
                ><em>Q</em><b class="number-value">${+f.q.toFixed(2)}</b></span
              ></button
            ><button class="band-remove" data-remove="${i}" aria-label="Remove band ${i + 1}">
              ×
            </button>
          </div>`,
      )
      .join('') +
    /* HTML */ `<button class="add-band" data-action="add" aria-label="Add band">
      ${icon('plus')}
    </button>`
  );
}
export function bandEditor(f: Filter | undefined, selected: number) {
  return !f
    ? '<div class="editor-empty">Select a band to edit its frequency, gain, and Q.</div>'
    : /* HTML */ ` <div class="detail-panel">
        <span class="detail-number" style="color:${bandColor(selected)}"
          >BAND ${String(selected + 1).padStart(2, '0')}</span
        ><label
          >FILTER TYPE<select id="filter-type">
            ${Object.entries(TYPES)
              .map(
                ([code, name]) =>
                  /* HTML */ ` <option value="${code}" ${f.type === code ? 'selected' : ''}>
                    ${name}
                  </option>`,
              )
              .join('')}
          </select></label
        ><label
          >FREQUENCY
          <div class="unit-input">
            <input
              id="frequency"
              data-adjust="frequency"
              type="number"
              min="20"
              max="20000"
              step="1"
              value="${+f.fcHz.toFixed(1)}"
            />Hz
          </div></label
        ><label
          >GAIN
          <div class="unit-input">
            <input
              id="gain"
              data-adjust="gain"
              type="number"
              step="0.1"
              value="${+f.gainDb.toFixed(1)}"
              ${['LP', 'HP'].includes(f.type) ? 'disabled' : ''}
            />dB
          </div></label
        ><label
          >Q FACTOR
          <div class="unit-input">
            <input
              id="q"
              data-adjust="q"
              type="number"
              min="0.1"
              max="20"
              step="0.05"
              value="${+f.q.toFixed(4)}"
            /></div></label
        >${ib('close-band', 'close', 'Close band editor')}
      </div>`;
}
export function presetList(state: Workspace, search: string) {
  return (
    state.presets
      .filter((p) => p.name.toLowerCase().includes(search))
      .map(
        (p) =>
          /* HTML */ ` <div
            class="preset-row ${p.id === state.activeId ? 'active' : ''}"
            data-preset-id="${esc(p.id)}"
          >
            <button
              class="preset-grip"
              data-reorder="${esc(p.id)}"
              aria-label="Reorder ${esc(p.name)}"
              title="Drag to reorder · arrow keys to move"
            >
              ⠿</button
            ><button class="preset-select" data-id="${esc(p.id)}">
              <span>${esc(p.name)}</span></button
            ><button
              class="preset-copy icon-button"
              data-copy-preset="${esc(p.id)}"
              aria-label="Duplicate ${esc(p.name)}"
              title="Duplicate preset"
            >
              ${icon('copy')}</button
            ><button
              class="preset-delete icon-button"
              data-delete-preset="${esc(p.id)}"
              aria-label="Delete ${esc(p.name)}"
              title="Delete preset"
            >
              ${icon('trash')}
            </button>
          </div>`,
      )
      .join('') || '<p class="empty">No matching presets</p>'
  );
}
export function channelButtons(p: Preset, channel: ChannelName) {
  return /* HTML */ `<button
      data-action="link"
      class="${p.linked ? 'active' : ''}"
      aria-pressed="${p.linked}"
    >
      L+R</button
    ><button data-action="split" class="${!p.linked ? 'active' : ''}" aria-pressed="${!p.linked}">
      L/R</button
    >${!p.linked ? /* HTML */ `<button data-action="left" class="${channel === 'left' ? 'active' : ''}">L</button><button data-action="right" class="${channel === 'right' ? 'active' : ''}">R</button>` : ''}`;
}
