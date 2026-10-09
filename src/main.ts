import { createEditorControls } from './ui/editor-controls.ts';
import { installInputClear } from './ui/input-clear.ts';
import { createEqualizerApoBackend } from './backends/equalizer-apo.ts';
import { createLiveSync } from './backends/live-sync.ts';
import { installBandRail } from './ui/band-rail.ts';
import { installBandReordering } from './ui/band-reorder.ts';
import { applyPresetImport, duplicateBand, moveBand } from './preset-edits.ts';
import { installBandHover } from './ui/band-hover.ts';
import { installCurveHover } from './ui/curve-hover.ts';
import { createFileActions } from './ui/file-actions.ts';
import { WorkspaceHistory } from './history.ts';
import { openModal, chooseFiles } from './ui/dialog.ts';
import { readCurveFiles } from './curve-import.ts';
import { query as $, eventElement } from './dom.ts';
import { escapeHtml as esc, errorMessage, curveRoles, activePreset } from './utils.ts';
import type { Workspace, Preset, ChannelName, CurveRole, Layers, Filter } from './types.ts';
import './style.css';
import './curve-picker.css';
import './controls.css';
import './scrollbars.css';
import './layout.css';
import './input-focus.css';
import {
  FREQUENCIES,
  clone,
  newBand,
  newPreset,
  initialState,
  validateState,
  response,
} from './model.ts';
import { createCurvePicker } from './curve-picker.ts';
import {
  findCurve,
  removeCustomCurve,
  loadBuiltinCurve,
  reorderedCustomCurves,
} from './curve-library.ts';
import { createSettingsPopup } from './settings-popup.ts';
import { installPresetReordering } from './preset-reorder.ts';
import { installPresetSlide } from './ui/preset-slide.ts';
import { createAutoEqPopup } from './autoeq-popup.ts';
import { createChart } from './ui/chart.ts';
import { getCurveDisplay } from './curve-level.ts';
import { installChartResize } from './ui/chart-resize.ts';
import { appMarkup, bandCards, bandEditor, presetList, channelButtons } from './ui/templates.ts';
import { icon } from './ui/icons.ts';
import { renderToggle } from './ui/toggle.ts';

const KEY = 'peq-studio.workspace.v1';
let state: Workspace,
  storageWarning = '';
try {
  const saved = localStorage.getItem(KEY);
  state = saved ? validateState(JSON.parse(saved)) : initialState();
} catch {
  state = initialState();
  storageWarning = 'Saved workspace could not be loaded. Export a backup before closing.';
}
let channel: ChannelName = 'left',
  selected = -1;
const curveRequests = { target: 0, source: 0 };
const layers: Layers = { target: true, source: true, bands: false, combined: true, filtered: true };
const workspaceHistory = new WorkspaceHistory();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let hasHistoryToast = false;

const preset = () => activePreset(state);
const current = () => preset()[preset().linked ? 'left' : channel];
function save() {
  syncBackend();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    $('#save-status').textContent = 'Saved locally';
  } catch {
    $('#save-status').textContent = 'Storage full · export a backup';
    toast('Storage full · export a backup');
  }
}
function snapshot(group?: symbol) {
  dismissHistoryToast();
  workspaceHistory.capture(state, group);
}
function commit(fn: () => void, group?: symbol) {
  snapshot(group);
  fn();
  syncLinked();
  save();
  render();
}
function syncLinked() {
  if (preset().linked) preset().right = clone(preset().left);
}
function toast(message: string, action?: () => void) {
  hasHistoryToast = false;
  const element = $('#toast');
  element.textContent = message;
  if (action) {
    const button = document.createElement('button');
    button.textContent = 'Undo';
    button.onclick = () => {
      action();
      element.classList.remove('visible');
    };
    element.append(button);
  }
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), action ? 10000 : 4000);
}
function undoToast(message: string) {
  toast(message, () => history(true));
  hasHistoryToast = true;
}
function dismissHistoryToast() {
  if (!hasHistoryToast) return;
  $('#toast').classList.remove('visible');
  hasHistoryToast = false;
}
function history(back: boolean) {
  const restored = workspaceHistory.restore(state, back);
  if (!restored) return;
  dismissHistoryToast();
  state = restored;
  selected = -1;
  save();
  render();
}

$('#app').innerHTML = appMarkup();

const apoBackend = createEqualizerApoBackend();
const LIVE_SYNC_KEY = 'peq-studio.live-sync.enabled';
let liveSyncEnabled = true;
try {
  liveSyncEnabled = localStorage.getItem(LIVE_SYNC_KEY) !== 'false';
} catch {
  /* Keep the current session usable when storage is unavailable. */
}
let backendMessage = 'Run the Go console backend locally to write peqstudio.txt.';
const liveSync = createLiveSync(
  apoBackend,
  (status) => {
    backendMessage = status.message;
    const element = $('#backend-status');
    element.textContent =
      status.kind === 'synced'
        ? 'APO · Synced'
        : status.kind === 'syncing'
          ? 'APO · Syncing…'
          : status.kind === 'off'
            ? 'APO · Off'
            : 'APO · Not synced';
    element.dataset.status = status.kind;
    element.title = `${status.message} Click for setup details.`;
    const detail = document.querySelector('#live-sync-status');
    if (detail) detail.textContent = status.message;
    const path = document.querySelector('#live-sync-path');
    if (path) path.textContent = apoBackend.configPath || 'peqstudio.txt';
  },
  2000,
  liveSyncEnabled,
);
function syncBackend() {
  liveSync.update(preset(), state.sampleRate);
}

const curvePickers = curveRoles.map((kind) =>
  createCurvePicker({
    root: $(`#${kind}-picker`),
    kind,
    getState: () => state,
    onSelect: async (id, group) => {
      const request = ++curveRequests[kind];
      const owner = preset();
      await loadBuiltinCurve(kind, id);
      if (request === curveRequests[kind] && owner === preset() && owner[`${kind}Id`] !== id)
        commit(() => {
          owner[`${kind}Id`] = id;
        }, group);
    },
    onDelete: (id) => {
      commit(() => removeCustomCurve(state, id));
      undoToast('Curve removed.');
    },
    onImport: () => importCurveFile(kind),
    onMove: (id, targetId, after) => {
      const curves = reorderedCustomCurves(state, id, targetId, after);
      if (!curves) return;
      commit(() => {
        state.curves = curves;
      });
      undoToast('Curve reordered.');
    },
  }),
);

const settingsPopup = createSettingsPopup({
  anchor: $<HTMLButtonElement>('[data-action="settings"]'),
  getState: () => state,
  onAlignmentChange: (method) => {
    if (method !== preset().curveAlignment.method)
      commit(() => {
        preset().curveAlignment.method = method;
      });
  },
});
function autoEqSignature() {
  return JSON.stringify({
    preset: preset(),
    channel,
    sampleRate: state.sampleRate,
    display: getCurveDisplay(state),
  });
}
const autoEqPopup = createAutoEqPopup({
  anchor: $<HTMLButtonElement>('[data-action="autoeq"]'),
  getOptions: () => state.autoEqOptions,
  onOptionsChange: (options) => {
    if (JSON.stringify(state.autoEqOptions) !== JSON.stringify(options)) {
      state.autoEqOptions = options;
      save();
    }
  },
  getContext: () => {
    const source = findCurve(state, 'source'),
      target = findCurve(state, 'target');
    if (!source || !target) throw Error('Choose a source and target curve first.');
    if (!source.points || !target.points)
      throw Error('Curve data is still loading. Please try again.');
    return {
      source: clone({ ...source, points: source.points }),
      target: clone({ ...target, points: target.points }),
      display: getCurveDisplay(state),
      sampleRate: state.sampleRate,
      signature: autoEqSignature(),
      scope: preset().linked ? 'both linked channels' : `${channel} channel`,
    };
  },
  onApply: (result, context) => {
    if (context.signature !== autoEqSignature())
      throw Error(
        'The preset or curves changed while fitting. Generate again to use the new settings.',
      );
    commit(() => {
      current().filters = result.filters;
      current().preampDb = result.preampDb;
      preset().enabled = true;
      preset().filtersEnabled = true;
      selected = result.filters.length ? 0 : -1;
    });
    undoToast(
      `Auto EQ: ${result.filters.length} bands · fit error ${result.fit.before.toFixed(2)} → ${result.fit.after.toFixed(2)} dB.`,
    );
  },
});

function renderPresets() {
  const search = $<HTMLInputElement>('#search').value.toLowerCase();
  $('#preset-count').textContent = String(state.presets.length);
  $('#presets').innerHTML = presetList(state, search);
}
function duplicatePreset(id: string) {
  const index = state.presets.findIndex((p) => p.id === id);
  const source = state.presets[index];
  if (!source) return;
  commit(() => {
    const copy = clone(source);
    copy.id = crypto.randomUUID();
    copy.name += ' · copy';
    state.presets.splice(index + 1, 0, copy);
    state.activeId = copy.id;
    selected = -1;
  });
}
function deletePreset(id: string) {
  const index = state.presets.findIndex((p) => p.id === id);
  if (index < 0) return;
  const removed = clone(state.presets[index]),
    nextId = state.presets[index + 1]?.id;
  const wasActive = state.activeId === id;
  let replacement: Preset | null = null;
  commit(() => {
    state.presets.splice(index, 1);
    if (!state.presets.length) {
      replacement = newPreset();
      state.presets.push(replacement);
    }
    if (wasActive) {
      state.activeId = state.presets[Math.min(index, state.presets.length - 1)].id;
      selected = -1;
    }
  });
  toast(`Deleted “${removed.name}”`, () => {
    if (state.presets.some((p) => p.id === id)) return;
    commit(() => {
      if (
        replacement &&
        JSON.stringify(state.presets.find((p) => p.id === replacement!.id)) ===
          JSON.stringify(replacement)
      )
        state.presets = state.presets.filter((p) => p.id !== replacement!.id);
      const nextIndex = state.presets.findIndex((p) => p.id === nextId);
      state.presets.splice(
        nextIndex < 0 ? Math.min(index, state.presets.length) : nextIndex,
        0,
        removed,
      );
      if (wasActive) {
        state.activeId = id;
        selected = -1;
      }
    });
  });
}
installPresetReordering($('#presets'), (id, targetId, after) => {
  const ids = state.presets.map((p) => p.id),
    from = ids.indexOf(id);
  if (from < 0 || id === targetId) return;
  ids.splice(from, 1);
  const to = ids.indexOf(targetId);
  if (to < 0) return;
  ids.splice(to + (after ? 1 : 0), 0, id);
  if (ids.every((value, i) => value === state.presets[i].id)) return;
  commit(() => {
    const byId = new Map(state.presets.map((p) => [p.id, p]));
    state.presets = ids.map((value) => byId.get(value)!);
  });
});
function selectPreset(id: string, focus = true) {
  if (state.activeId === id) return;
  state.activeId = id;
  selected = -1;
  channel = 'left';
  save();
  render();
  if (focus)
    Array.from(document.querySelectorAll<HTMLElement>('.preset-select'))
      .find((button) => button.dataset.id === id)
      ?.focus({ preventScroll: true });
}
installPresetSlide($('#presets'), (id) => selectPreset(id, false));
function render() {
  const p = preset(),
    c = current();
  if (selected >= c.filters.length) selected = -1;
  renderPresets();
  $('#preset-name').innerHTML = /* HTML */ `${esc(p.name)}<span class="rename-icon"
      >${icon('edit')}</span
    >`;
  updateHistoryButtons();
  $('#channel-mode').innerHTML = channelButtons(p, channel);
  $<HTMLInputElement>('#power').checked = p.enabled;
  const compare = $<HTMLButtonElement>('#compare');
  compare.disabled = !p.enabled;
  compare.textContent = p.filtersEnabled ? 'A · EQ' : 'B · Preamp only';
  compare.setAttribute('aria-pressed', String(!p.filtersEnabled));
  compare.title = !p.enabled
    ? 'Turn Power on to compare EQ with preamp only'
    : 'Compare with filters bypassed, keeping the same preamp · Shortcut B';
  curvePickers.forEach((picker) => picker.update());
  settingsPopup.update();
  autoEqPopup.update();
  const labels: Record<keyof Layers, string> = {
    target: 'Target',
    source: 'Source response',
    bands: 'Each filter',
    combined: 'Combined filter',
    filtered: 'Filtered response',
  };
  $('#legend').innerHTML = Object.entries(labels)
    .map(
      ([key, label]) =>
        /* HTML */ `<button
          data-layer="${key}"
          class="legend-chip ${key} ${layers[key as keyof Layers] ? 'on' : ''}"
          aria-pressed="${layers[key as keyof Layers]}"
        >
          <i></i>${label}
        </button>`,
    )
    .join('');
  $<HTMLInputElement>('#preamp').value = String(+c.preampDb.toFixed(1));
  $<HTMLInputElement>('#preamp-range').min = String(Math.min(-24, c.preampDb));
  $<HTMLInputElement>('#preamp-range').max = String(Math.max(12, c.preampDb));
  $<HTMLInputElement>('#preamp-range').value = String(c.preampDb);
  $('#band-count').textContent = String(c.filters.length);
  $('#bands').innerHTML = bandCards(c, selected);
  renderBandEditor();
  chartResize.update();
  chart.draw();
  void restoreSelectedCurves();
  $('#sample-rate-label').textContent = String(`${state.sampleRate / 1000} kHz`);
}
function renderBandEditor() {
  const f = current().filters[selected];
  $('#band-editor').innerHTML = bandEditor(f, selected);
}

const chart = createChart({
  getState: () => state,
  getChannel: current,
  getSelected: () => selected,
  getLayers: () => layers,
  onViewChange: (window) => {
    Object.assign(state.chartView, window);
    save();
  },
  onSelect: (index) => {
    selected = index;
    renderBandEditor();
    editorControls.refresh();
  },
  onBegin: snapshot,
  onChange: () => {
    syncLinked();
    syncBackend();
    editorControls.refresh();
  },
  onEnd: () => {
    save();
    render();
  },
  onAdd: addBand,
  onCommit: (index, mutate) => {
    selected = index;
    commit(() => mutate(current().filters[index]));
  },
});
const chartResize = installChartResize({
  getHeight: () => state.chartView.height,
  onChange: (height) => {
    state.chartView.height = height;
  },
  onEnd: save,
});
function addBand(hz = 1000, db = 0) {
  commit(() => {
    current().filters.push(newBand(Math.round(hz), +db.toFixed(1)));
    selected = current().filters.length - 1;
  });
}
function importCurveFile(kind: CurveRole) {
  const ownerId = state.activeId;
  chooseFiles(
    '.csv,.txt,.tsv',
    async (files) => {
      const { curves, errors } = await readCurveFiles(files);
      if (!curves.length) {
        toast(errors.join(' '));
        return;
      }
      commit(() => {
        state.curves.push(...curves);
        const owner = state.presets.find((p) => p.id === ownerId);
        if (owner) owner[`${kind}Id`] = curves[0].id;
      });
      if ($<HTMLDialogElement>('#modal').open) $<HTMLDialogElement>('#modal').close();
      const added =
        curves.length === 1 ? `Added ${curves[0].name}` : `Added ${curves.length} curves`;
      undoToast(
        `${added}${errors.length ? `. Skipped ${errors.length}: ${errors.join(' ')}` : ''}`,
      );
    },
    toast,
  );
}
const actions: Record<string, () => void | Promise<void>> = {
  compare: () => {
    if (!preset().enabled) return;
    commit(() => {
      preset().filtersEnabled = !preset().filtersEnabled;
    });
  },
  'backend-info': () => {
    openModal(
      'Equalizer APO live sync',
      `<div class="live-sync-panel">
       <div class="live-sync-control">
         ${renderToggle('Live sync', { id: 'live-sync-enabled', checked: liveSyncEnabled })}
         <p>Automatically send active preset changes to Equalizer APO.</p>
         <p id="live-sync-status" role="status">${esc(backendMessage)}</p>
       </div>
       <ol class="live-sync-steps">
         <li><strong>Start the local backend</strong>
           <code class="live-sync-command">npm run backend</code>
           <p>Keep its console open. Allow local network access if your browser asks.</p>
         </li>
         <li><strong>Include the preset file in Equalizer APO</strong>
           <p>In Configuration Editor, add an Include entry for this file:</p>
           <code id="live-sync-path" class="live-sync-command">${esc(apoBackend.configPath || 'peqstudio.txt')}</code>
           <p>Or add <code>Include: peqstudio.txt</code> to your configuration.</p>
         </li>
       </ol>
       <p class="live-sync-note">“Synced” means the file was saved. It affects audio only when included in your active APO configuration. Turning sync off or closing the console keeps the last applied settings.</p>
       <details class="live-sync-details"><summary>Connection details</summary>
         <p>Both the local and GitHub Pages editors connect to <code>127.0.0.1:8765</code>. PEQ Studio writes <code>peqstudio.txt</code> and never edits <code>config.txt</code>.</p>
       </details>
       </div>
       <div class="modal-actions"><button data-action="close-modal">Close</button></div>`,
      { anchor: '#backend-status', width: 460 },
    );
    $<HTMLInputElement>('#live-sync-enabled').addEventListener('change', (event) => {
      liveSyncEnabled = (event.target as HTMLInputElement).checked;
      try {
        localStorage.setItem(LIVE_SYNC_KEY, String(liveSyncEnabled));
      } catch {
        toast('Live sync changed for this session, but the preference could not be saved.');
      }
      liveSync.setEnabled(liveSyncEnabled);
    });
  },
  ...createFileActions({
    getState: () => state,
    getPreset: preset,
    getChannelConfig: current,
    getChannelName: () => channel,
    onImport: (p, mode) => {
      commit(() => {
        applyPresetImport(state, p, mode);
        selected = -1;
      });
    },
    onRestore: (restored) => {
      commit(() => {
        state = restored;
        selected = -1;
      });
    },
    toast,
    undoToast,
  }),
  new: () =>
    commit(() => {
      const p = newPreset(`Local preset ${state.presets.length + 1}`);
      state.presets.push(p);
      state.activeId = p.id;
      selected = -1;
    }),
  duplicate: () => duplicatePreset(state.activeId),
  rename: () => startRename(),
  'delete-preset': () => {
    $<HTMLDialogElement>('#modal').close();
    deletePreset(state.activeId);
  },
  undo: () => history(true),
  redo: () => history(false),
  link: () => {
    if (preset().linked) return;
    openModal(
      'Link left and right',
      /* HTML */ ` <p>
          The ${channel} channel will be copied to both channels. You can undo this change.
        </p>
        <div class="modal-actions">
          <button data-action="close-modal">Cancel</button
          ><button class="primary" data-action="confirm-link">Use ${channel} for both</button>
        </div>`,
      { anchor: '[data-action="link"]', width: 360 },
    );
  },
  'confirm-link': () => {
    $<HTMLDialogElement>('#modal').close();
    commit(() => {
      const c = clone(current());
      preset().left = c;
      preset().linked = true;
      channel = 'left';
    });
  },
  split: () => {
    if (preset().linked)
      commit(() => {
        preset().linked = false;
        channel = 'left';
      });
  },
  left: () => {
    channel = 'left';
    selected = -1;
    render();
  },
  right: () => {
    channel = 'right';
    selected = -1;
    render();
  },
  add: () => addBand(),
  'close-band': () => {
    selected = -1;
    render();
  },
  clear: () => {
    if (!current().filters.length) return;
    commit(() => {
      current().filters = [];
      selected = -1;
    });
    undoToast('Bands cleared for the active channel.');
  },
  'auto-preamp': () => {
    const c = current();
    const max = Math.max(
      ...FREQUENCIES.map((hz) => response({ ...c, preampDb: 0 }, hz, state.sampleRate)),
    );
    commit(() => {
      current().preampDb = -Math.ceil(Math.max(0, max) * 10) / 10;
    });
  },
  'zoom-in': () => {
    if (state.curveDisplay.rangeDb > 5)
      commit(() => {
        state.curveDisplay.rangeDb = Math.max(5, state.curveDisplay.rangeDb - 5);
      });
  },
  'zoom-out': () =>
    commit(() => {
      state.curveDisplay.rangeDb += 5;
    }),
  'zoom-frequency-in': () => chart.zoom(2),
  'zoom-frequency-out': () => chart.zoom(0.5),
  'reset-frequency': () => chart.resetZoom(),
  settings: () => {
    autoEqPopup.close();
    settingsPopup.toggle();
  },
  autoeq: () => {
    settingsPopup.close();
    autoEqPopup.toggle();
  },
};
document.addEventListener('click', (event) => {
  const removePreset = eventElement(event).closest<HTMLElement>('[data-delete-preset]');
  if (removePreset) return deletePreset(removePreset.dataset.deletePreset!);
  const copyPreset = eventElement(event).closest<HTMLElement>('[data-copy-preset]');
  if (copyPreset) return duplicatePreset(copyPreset.dataset.copyPreset!);
  const action = eventElement(event).closest<HTMLElement>('[data-action]');
  if (action) {
    const name = action.dataset.action!;
    const panel = $<HTMLDialogElement>('#modal');
    if (
      panel.open &&
      action.getAttribute('aria-controls') === 'modal' &&
      action.getAttribute('aria-expanded') === 'true'
    ) {
      panel.close();
      return;
    }
    if (['export', 'import', 'backup', 'backend-info', 'link'].includes(name)) {
      settingsPopup.close();
      autoEqPopup.close();
    } else if (['settings', 'autoeq'].includes(name) && panel.open) panel.close();
    return actions[name]?.();
  }
  const row = eventElement(event).closest<HTMLElement>('[data-id]');
  if (row) {
    selectPreset(row.dataset.id!);
    return;
  }
  const band = eventElement(event).closest<HTMLElement>('[data-band]');
  if (band) {
    selected = +band.dataset.band!;
    // Keep card nodes in place so multi-click and hover gestures remain intact.
    renderBandEditor();
    editorControls.refresh();
    chart.draw();
    return;
  }
  const toggle = eventElement(event).closest<HTMLElement>('[data-toggle]');
  if (toggle) {
    commit(() => {
      const f = current().filters[+toggle.dataset.toggle!];
      f.enabled = !f.enabled;
    });
    return;
  }
  const remove = eventElement(event).closest<HTMLElement>('[data-remove]');
  if (remove) {
    commit(() => {
      current().filters.splice(+remove.dataset.remove!, 1);
      selected = -1;
    });
    return;
  }
  const duplicate = eventElement(event).closest<HTMLElement>('[data-duplicate-band]');
  if (duplicate) {
    commit(() => {
      selected = duplicateBand(current(), Number(duplicate.dataset.duplicateBand));
    });
    document
      .querySelector(`[data-band-card="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    undoToast('Band duplicated.');
    return;
  }
  const layer = eventElement(event).closest<HTMLElement>('[data-layer]');
  if (layer) {
    layers[layer.dataset.layer as keyof Layers] = !layers[layer.dataset.layer as keyof Layers];
    render();
  }
});
let renamingId: string | null = null;
const renameInput = document.createElement('input');
renameInput.id = 'rename-input';
renameInput.maxLength = 100;
renameInput.hidden = true;
renameInput.setAttribute('aria-label', 'Preset name');
renameInput.title = 'Enter to save · Escape to cancel';
$('#preset-name').after(renameInput);
const renameClear = installInputClear(renameInput, renameInput.parentElement!);
function startRename() {
  renamingId = state.activeId;
  renameInput.value = preset().name;
  $('#preset-name').hidden = true;
  renameInput.hidden = false;
  renameClear.update();
  renameInput.focus();
  renameInput.select();
}
function finishRename(cancel = false) {
  if (!renamingId) return;
  const id = renamingId,
    name = renameInput.value.trim();
  renamingId = null;
  renameInput.hidden = true;
  renameClear.update();
  $('#preset-name').hidden = false;
  const p = state.presets.find((p) => p.id === id);
  if (!cancel && p && name && name !== p.name)
    commit(() => {
      p.name = name;
    });
}
renameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    finishRename(event.key === 'Escape');
    $('#preset-name').focus();
  }
});
renameInput.addEventListener('blur', (event) => {
  if (event.relatedTarget !== renameClear.button) finishRename();
});
renameClear.button.addEventListener('blur', (event) => {
  if (event.relatedTarget !== renameInput) finishRename();
});
installInputClear($<HTMLInputElement>('#search'));
$<HTMLInputElement>('#search').addEventListener('input', renderPresets);
const editorControls = createEditorControls({
  getState: () => state,
  getChannel: current,
  getSelected: () => selected,
  onSelect: (index) => {
    selected = index;
    renderBandEditor();
  },
  onBegin: snapshot,
  onChange: () => {
    syncLinked();
    syncBackend();
    chart.draw();
    settingsPopup.update();
  },
  onEnd: save,
  onRefresh: updateHistoryButtons,
});
installBandHover();
installCurveHover();
function updateHistoryButtons() {
  $<HTMLButtonElement>('[data-action="undo"]').disabled = !workspaceHistory.canUndo;
  $<HTMLButtonElement>('[data-action="redo"]').disabled = !workspaceHistory.canRedo;
}
document.addEventListener('change', (event) => {
  const el = eventElement(event) as HTMLInputElement;
  if (el.id === 'power')
    commit(() => {
      preset().enabled = el.checked;
    });
  if (el instanceof HTMLInputElement && el.name === 'filter-type') {
    const type = el.value as Filter['type'];
    commit(() => {
      current().filters[selected].type = type;
    });
    $<HTMLInputElement>(`input[name="filter-type"][value="${type}"]`).focus({
      preventScroll: true,
    });
  }
  if (el.id === 'sample-rate') {
    commit(() => {
      state.sampleRate = +el.value;
    });
  }
  if (el.id === 'compensated')
    commit(() => {
      state.curveDisplay.compensated = el.checked;
    });
  if (el.id === 'include-preamp')
    commit(() => {
      state.curveDisplay.includePreamp = el.checked;
    });
});
document.addEventListener('keydown', (event) => {
  if (
    eventElement(event).closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
    ) ||
    $<HTMLDialogElement>('#modal').open
  )
    return;
  if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!event.repeat) actions.compare();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    history(!event.shiftKey);
  } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    history(false);
  }
});
render();
syncBackend();
installBandRail();
installBandReordering($('#bands'), (from, to) => {
  commit(() => {
    selected = moveBand(current(), from, to, selected);
  });
});
if (storageWarning) toast(storageWarning);
async function restoreSelectedCurves() {
  await Promise.all(
    curveRoles.map(async (kind) => {
      const id = preset()[`${kind}Id`];
      if (!id.startsWith('builtin-source:') || findCurve(state, kind)?.points) return;
      try {
        await loadBuiltinCurve(kind, id);
        if (preset()[`${kind}Id`] === id) {
          chart.draw();
          settingsPopup.update();
          autoEqPopup.update();
        }
      } catch (error) {
        toast(errorMessage(error));
      }
    }),
  );
}
