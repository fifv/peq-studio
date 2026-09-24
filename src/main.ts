import { createEditorControls } from './ui/editor-controls.ts';
import { createFileActions } from './ui/file-actions.ts';
import { WorkspaceHistory } from './history.ts';
import { openModal, chooseFile as chooseFileWithErrors } from './ui/dialog.ts';
import { query as $, eventElement } from './dom.ts';
import { escapeHtml as esc, errorMessage, curveRoles } from './utils.ts';
import type { Workspace, Preset, ChannelName, CurveRole, Layers, Filter } from './types.ts';
import './style.css';
import './curve-picker.css';
import './controls.css';
import './scrollbars.css';
import {
  FREQUENCIES,
  clone,
  newBand,
  newPreset,
  initialState,
  validateState,
  parseCurve,
  response,
} from './model.ts';
import { createCurvePicker } from './curve-picker.ts';
import { findCurve, removeCustomCurve, loadBuiltinCurve } from './curve-library.ts';
import { createSettingsPopup } from './settings-popup.ts';
import { installPresetReordering } from './preset-reorder.ts';
import { createAutoEqPopup } from './autoeq-popup.ts';
import { createChart } from './ui/chart.ts';
import { appMarkup, bandCards, bandEditor, presetList, channelButtons } from './ui/templates.ts';

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

const preset = () => state.presets.find((p) => p.id === state.activeId)!;
const current = () => preset()[preset().linked ? 'left' : channel];
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    $('#save-status').textContent = 'Saved locally';
  } catch {
    $('#save-status').textContent = 'Storage full · export a backup';
    toast('Storage full · export a backup');
  }
}
function snapshot() {
  workspaceHistory.capture(state);
}
function commit(fn: () => void) {
  snapshot();
  fn();
  syncLinked();
  save();
  render();
}
function syncLinked() {
  if (preset().linked) preset().right = clone(preset().left);
}
function toast(message: string, action?: () => void) {
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
function history(back: boolean) {
  const restored = workspaceHistory.restore(state, back);
  if (!restored) return;
  state = restored;
  selected = -1;
  save();
  render();
  void restoreSelectedCurves();
}

$('#app').innerHTML = appMarkup();

const curvePickers = curveRoles.map((kind) =>
  createCurvePicker({
    root: $(`#${kind}-picker`),
    kind,
    getState: () => state,
    onSelect: async (id) => {
      const request = ++curveRequests[kind];
      await loadBuiltinCurve(kind, id);
      if (request === curveRequests[kind])
        commit(() => {
          state[`${kind}Id`] = id;
        });
    },
    onDelete: (id) => {
      commit(() => removeCustomCurve(state, id));
      toast('Curve removed. Undo is available.');
    },
    onImport: () => importCurveFile(kind),
  }),
);

const settingsPopup = createSettingsPopup({
  anchor: $<HTMLButtonElement>('[data-action="settings"]'),
  getState: () => state,
  onAlignmentChange: (method) => {
    if (method !== state.curveDisplay.method)
      commit(() => {
        state.curveDisplay.method = method;
      });
  },
});
function autoEqSignature() {
  return JSON.stringify({
    preset: preset(),
    channel,
    sourceId: state.sourceId,
    targetId: state.targetId,
    sampleRate: state.sampleRate,
    display: state.curveDisplay,
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
      display: clone(state.curveDisplay),
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
      selected = result.filters.length ? 0 : -1;
    });
    toast(
      `Auto EQ: ${result.filters.length} bands · fit error ${result.fit.before.toFixed(2)} → ${result.fit.after.toFixed(2)} dB. Undo available.`,
    );
  },
});

function renderPresets() {
  const search = $<HTMLInputElement>('#search').value.toLowerCase();
  $('#preset-count').textContent = String(state.presets.length);
  $('#presets').innerHTML = presetList(state, search);
}
function duplicatePreset(id: string) {
  const source = state.presets.find((p) => p.id === id);
  if (!source) return;
  commit(() => {
    const copy = clone(source);
    copy.id = crypto.randomUUID();
    copy.name += ' · copy';
    state.presets.push(copy);
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
function render() {
  const p = preset(),
    c = current();
  if (selected >= c.filters.length) selected = -1;
  renderPresets();
  $('#preset-name').innerHTML = /* HTML */ `${esc(p.name)}<span class="rename-icon">↗</span>`;
  updateHistoryButtons();
  $('#channel-mode').innerHTML = channelButtons(p, channel);
  $<HTMLInputElement>('#power').checked = p.enabled;
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
  chart.draw();
  $('#sample-rate-label').textContent = String(`${state.sampleRate / 1000} kHz`);
}
function renderBandEditor() {
  const f = current().filters[selected];
  $('#band-editor').innerHTML = bandEditor(f, selected);
}

const chart = createChart({
  getState: () => state,
  getPreset: preset,
  getChannel: current,
  getSelected: () => selected,
  getLayers: () => layers,
  onSelect: (index) => {
    selected = index;
    renderBandEditor();
    editorControls.refresh();
  },
  onBegin: snapshot,
  onChange: () => {
    syncLinked();
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
function addBand(hz = 1000, db = 0) {
  commit(() => {
    current().filters.push(newBand(Math.round(hz), +db.toFixed(1)));
    selected = current().filters.length - 1;
  });
}
const chooseFile = (
  accept: string,
  handler: (text: string, name: string, fileName: string) => void | Promise<void>,
) => chooseFileWithErrors(accept, handler, toast);
function importCurveFile(kind: CurveRole) {
  chooseFile('.csv,.txt,.tsv', (text, name, fileName) => {
    const curve = { ...parseCurve(text, fileName || name), kind: 'both' as const };
    commit(() => {
      state.curves.push(curve);
      state[`${kind}Id`] = curve.id;
    });
    if ($<HTMLDialogElement>('#modal').open) $<HTMLDialogElement>('#modal').close();
    toast(`Added ${curve.name}`);
  });
}
const actions: Record<string, () => void | Promise<void>> = {
  ...createFileActions({
    getState: () => state,
    getPreset: preset,
    getChannelConfig: current,
    getChannelName: () => channel,
    onImport: (p) => {
      commit(() => {
        state.presets.push(p);
        state.activeId = p.id;
        selected = -1;
      });
    },
    onRestore: (restored) => {
      commit(() => {
        state = restored;
        selected = -1;
      });
      void restoreSelectedCurves();
    },
    toast,
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
    toast('Bands cleared for the active channel. Undo is available.');
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
  if (action) return actions[action.dataset.action!]?.();
  const row = eventElement(event).closest<HTMLElement>('[data-id]');
  if (row) {
    state.activeId = row.dataset.id!;
    selected = -1;
    channel = 'left';
    save();
    render();
    return;
  }
  const band = eventElement(event).closest<HTMLElement>('[data-band]');
  if (band) {
    selected = +band.dataset.band!;
    render();
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
function startRename() {
  renamingId = state.activeId;
  renameInput.value = preset().name;
  $('#preset-name').hidden = true;
  renameInput.hidden = false;
  renameInput.focus();
  renameInput.select();
}
function finishRename(cancel = false) {
  if (!renamingId) return;
  const id = renamingId,
    name = renameInput.value.trim();
  renamingId = null;
  renameInput.hidden = true;
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
renameInput.addEventListener('blur', () => finishRename());
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
    chart.draw();
    settingsPopup.update();
  },
  onEnd: save,
  onRefresh: updateHistoryButtons,
});
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
  if (el.id === 'filter-type')
    commit(() => {
      current().filters[selected].type = el.value as Filter['type'];
    });
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
  if (eventElement(event).matches('input,textarea,select') || $<HTMLDialogElement>('#modal').open)
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    history(!event.shiftKey);
  }
});
render();
if (storageWarning) toast(storageWarning);
async function restoreSelectedCurves() {
  await Promise.all(
    curveRoles.map(async (kind) => {
      const id = state[`${kind}Id`];
      if (typeof id !== 'string' || !id.startsWith('builtin-source:')) return;
      try {
        await loadBuiltinCurve(kind, id);
        if (state[`${kind}Id`] === id) {
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
restoreSelectedCurves();
