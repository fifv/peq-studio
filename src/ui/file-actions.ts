import type { Workspace, Preset, Channel, ChannelName } from '../types.ts';
import { query as $ } from '../dom.ts';
import { escapeHtml as esc, errorMessage, clone, activePreset } from '../utils.ts';
import { exportText, exportPreset, importPreset, validateState } from '../model.ts';
import { icon } from './icons.ts';
import { download, openModal, chooseFile as chooseFileWithErrors } from './dialog.ts';
import type { ImportMode } from '../preset-edits.ts';
import { exportFilteredCurve } from '../curve-export.ts';
import { loadBuiltinCurve } from '../curve-library.ts';
import { renderToggle } from './toggle.ts';

const IMPORT_MODE_KEY = 'peq-studio.import-mode';
const EXPORT_PREAMP_KEY = 'peq-studio.export-include-preamp';
interface FileActionsOptions {
  getState: () => Workspace;
  getPreset: () => Preset;
  getChannelConfig: () => Channel;
  getChannelName: () => ChannelName;
  onImport: (preset: Preset, mode: ImportMode) => void;
  onRestore: (state: Workspace) => void;
  toast: (message: string) => void;
  undoToast: (message: string) => void;
}
export function createFileActions({
  getState,
  getPreset,
  getChannelConfig,
  getChannelName,
  onImport,
  onRestore,
  toast,
  undoToast,
}: FileActionsOptions): Record<string, () => void | Promise<void>> {
  let preferredImportMode: ImportMode = 'new';
  let exportIncludePreamp = true;
  try {
    exportIncludePreamp = localStorage.getItem(EXPORT_PREAMP_KEY) !== 'false';
  } catch {
    // Export stays usable when browser storage is unavailable.
  }
  try {
    const saved = localStorage.getItem(IMPORT_MODE_KEY);
    if (saved === 'new' || saved === 'replace' || saved === 'append') preferredImportMode = saved;
  } catch {
    // Keep the preference for this session when browser storage is unavailable.
  }
  const fileName = () => getPreset().name.replace(/[<>:"/\\|?*]/g, '_');
  const chooseFile = (
    accept: string,
    handler: (text: string, name: string, fileName: string) => void | Promise<void>,
  ) => chooseFileWithErrors(accept, handler, toast);
  const importMode = (): ImportMode =>
    $<HTMLInputElement>('input[name="import-mode"]:checked').value as ImportMode;
  function doImport(text: string, name: string, mode: ImportMode) {
    const preset = importPreset(text, name);
    onImport(preset, mode);
    $<HTMLDialogElement>('#modal').close();
    undoToast(
      mode === 'new'
        ? `Imported ${preset.name}`
        : mode === 'replace'
          ? 'Preset replaced.'
          : 'Bands appended.',
    );
  }
  const backupText = () => JSON.stringify(getState(), null, 2);
  function restoreBackup(text: string) {
    const restored = validateState(JSON.parse(text));
    onRestore(restored);
    $<HTMLDialogElement>('#modal').close();
    undoToast('Workspace restored.');
  }
  function restorePastedBackup(text: string) {
    try {
      restoreBackup(text);
    } catch (error) {
      $('#backup-error').textContent = errorMessage(error);
    }
  }
  function showBackupText(mode: 'copy' | 'paste', text = '') {
    const copying = mode === 'copy';
    openModal(
      copying ? 'Copy workspace backup' : 'Paste workspace backup',
      /* HTML */ `<p>
          ${
            copying
              ? 'Clipboard access is unavailable. Copy the selected backup text.'
              : 'Paste your backup below to replace this workspace. You can undo the restore.'
          }
        </p>
        <label class="config-label" for="backup-text">Workspace JSON</label>
        <textarea
          id="backup-text"
          class="config-text"
          rows="10"
          spellcheck="false"
          ${copying ? 'readonly' : ''}
        ></textarea>
        <p class="form-error" id="backup-error" role="alert"></p>
        ${
          copying
            ? ''
            : '<div class="modal-actions"><button class="primary" data-action="backup-paste">Restore workspace</button></div>'
        }`,
    );
    const field = $<HTMLTextAreaElement>('#backup-text');
    field.value = text;
    field.focus();
    if (copying) field.select();
  }
  return {
    export: () => {
      openModal(
        'Export preset',
        /* HTML */ ` <p>
            Equalizer APO configuration for
            ${getPreset().linked ? 'both linked channels' : `the ${getChannelName()} channel`}. Copy
            it below or download a file.
          </p>
          <div class="config-heading">
            <label class="config-label" for="export-text">APO configuration</label>
            ${renderToggle('Include preamp', { id: 'export-include-preamp', checked: exportIncludePreamp, className: 'config-preamp-toggle' })}
          </div>
          <textarea
            id="export-text"
            class="config-text"
            rows="10"
            readonly
            spellcheck="false"
            aria-label="APO configuration"
          >
${esc(exportText(getChannelConfig(), exportIncludePreamp))}</textarea>
          <div class="config-copy-row">
            <span id="copy-status" role="status"></span
            ><button class="primary" data-action="copy-apo">
              ${icon('copy')} Copy configuration
            </button>
          </div>
          <div class="export-options">
            <button data-action="export-txt">
              ${icon('download')} Filter settings <small>Equalizer APO / REW · .txt</small></button
            ><button data-action="export-json">
              ${icon('download')} Complete preset <small>Left + right channels · .json</small>
            </button>
            <button data-action="export-filtered" ${getPreset().sourceId ? '' : 'disabled'}>
              ${icon('download')} Filtered curve
              <small
                >${getPreset().sourceId ? 'Current display levels · frequency / dB · .csv' : 'Choose a source curve first'}</small
              >
            </button>
          </div>`,
      );
      $<HTMLInputElement>('#export-include-preamp').addEventListener('change', (event) => {
        exportIncludePreamp = (event.target as HTMLInputElement).checked;
        $<HTMLTextAreaElement>('#export-text').value = exportText(
          getChannelConfig(),
          exportIncludePreamp,
        );
        $('#copy-status').textContent = '';
        try {
          localStorage.setItem(EXPORT_PREAMP_KEY, String(exportIncludePreamp));
        } catch {
          // Retain the choice for this session if storage is blocked.
        }
      });
    },
    'copy-apo': async () => {
      const field = $<HTMLTextAreaElement>('#export-text'),
        status = $('#copy-status');
      try {
        await navigator.clipboard.writeText(field.value);
        status.textContent = 'Copied';
      } catch {
        field.focus();
        field.select();
        status.textContent = 'Press Ctrl+C to copy the selected configuration.';
      }
    },
    'export-txt': () => {
      download(
        `${fileName()}-${getPreset().linked ? 'LR' : getChannelName()}.txt`,
        exportText(getChannelConfig()),
      );
      $<HTMLDialogElement>('#modal').close();
    },
    'export-json': () => {
      download(`${fileName()}.json`, exportPreset(getPreset()), 'application/json');
      $<HTMLDialogElement>('#modal').close();
    },
    'export-filtered': async () => {
      const state = clone(getState());
      const preset = activePreset(state);
      const channel = clone(getChannelConfig());
      const name = `${fileName()}-${preset.linked ? 'LR' : getChannelName()}-filtered.csv`;
      try {
        await Promise.all([
          loadBuiltinCurve('source', preset.sourceId),
          state.curveDisplay.compensated ? loadBuiltinCurve('target', preset.targetId) : undefined,
        ]);
        download(
          name,
          exportFilteredCurve(state, channel, preset.enabled, preset.filtersEnabled),
          'text/csv',
        );
        $<HTMLDialogElement>('#modal').close();
      } catch (error) {
        toast(errorMessage(error));
      }
    },
    import: () => {
      openModal(
        'Import preset',
        /* HTML */ ` <p>Paste an Equalizer APO configuration below or choose a file.</p>
          <fieldset class="import-modes">
            <legend>Import into</legend>
            <label
              ><input type="radio" name="import-mode" value="new" checked /><span
                >New preset</span
              ></label
            >
            <label
              ><input type="radio" name="import-mode" value="replace" /><span
                >Replace current</span
              ></label
            >
            <label
              ><input type="radio" name="import-mode" value="append" /><span
                >Append to current</span
              ></label
            >
          </fieldset>
          <p class="small-text">
            Replace updates filters and preamp. Append adds bands and keeps the current preamp. Both
            can be undone; stereo imports preserve separate channels.
          </p>
          <label class="config-label" for="import-text">APO configuration</label
          ><textarea
            id="import-text"
            class="config-text"
            rows="10"
            spellcheck="false"
            aria-label="APO configuration to import"
            placeholder="Preamp: -5.5 dB&#10;Filter 1: ON PK Fc 1200 Hz Gain 5.4 dB Q 1.5"
          ></textarea>
          <p class="form-error" id="import-error" role="alert"></p>
          <div class="modal-actions">
            <button class="primary" data-action="import-paste">Import configuration</button>
          </div>
          <div class="or-divider">or import a file</div>
          <button data-action="import-file" class="wide">${icon('upload')} Choose a file</button>
          <p class="small-text">TOPPING / REW / Equalizer APO TXT, filter CSV, or PEQ JSON.</p>`,
      );
      $<HTMLInputElement>(`input[name="import-mode"][value="${preferredImportMode}"]`).checked =
        true;
      $('.import-modes').addEventListener('change', () => {
        preferredImportMode = importMode();
        try {
          localStorage.setItem(IMPORT_MODE_KEY, preferredImportMode);
        } catch {
          // Reopening the dialog still remembers the choice in this session.
        }
      });
    },
    'import-file': () => {
      const mode = importMode();
      chooseFile('.txt,.json,.csv', (text, name) => doImport(text, name, mode));
    },
    'import-paste': () => {
      try {
        doImport($<HTMLTextAreaElement>('#import-text').value, 'Imported preset', importMode());
      } catch (e) {
        $('#import-error').textContent = String(errorMessage(e));
      }
    },
    backup: () =>
      openModal(
        'Workspace backup',
        /* HTML */ `<p>Back up all presets, both channels, and imported response curves.</p>
          <div class="export-options">
            <button data-action="backup-copy">
              ${icon('copy')} Copy backup to clipboard<small>All workspace data · JSON</small>
            </button>
            <button data-action="backup-clipboard">
              ${icon('upload')} Restore from clipboard
              <small>Replaces this workspace · undo available</small>
            </button>
            <button data-action="backup-save">
              ${icon('download')} Download backup<small>All workspace data · JSON</small>
            </button>
            <button data-action="backup-restore">
              ${icon('upload')} Restore backup file
              <small>Replaces this workspace · undo available</small>
            </button>
          </div>
          <p id="backup-status" role="status" class="small-text"></p>
          <p id="backup-error" role="alert" class="form-error"></p>`,
      ),
    'backup-copy': async () => {
      const text = backupText();
      try {
        await navigator.clipboard.writeText(text);
        $('#backup-status').textContent = 'Backup copied to clipboard.';
        $('#backup-error').textContent = '';
      } catch {
        showBackupText('copy', text);
      }
    },
    'backup-clipboard': async () => {
      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        showBackupText('paste');
        return;
      }
      $('#backup-status').textContent = '';
      restorePastedBackup(text);
    },
    'backup-paste': () => restorePastedBackup($<HTMLTextAreaElement>('#backup-text').value),
    'backup-save': () => {
      download('peq-workspace.json', backupText(), 'application/json');
      $<HTMLDialogElement>('#modal').close();
    },
    'backup-restore': () => chooseFile('.json', restoreBackup),
    'close-modal': () => $<HTMLDialogElement>('#modal').close(),
  };
}
