import type { Workspace, Preset, Channel, ChannelName } from '../types.ts';
import { query as $ } from '../dom.ts';
import { escapeHtml as esc, errorMessage } from '../utils.ts';
import { exportText, exportPreset, importPreset, validateState } from '../model.ts';
import { icon } from './icons.ts';
import { download, openModal, chooseFile as chooseFileWithErrors } from './dialog.ts';
interface FileActionsOptions {
  getState: () => Workspace;
  getPreset: () => Preset;
  getChannelConfig: () => Channel;
  getChannelName: () => ChannelName;
  onImport: (preset: Preset) => void;
  onRestore: (state: Workspace) => void;
  toast: (message: string) => void;
}
export function createFileActions({
  getState,
  getPreset,
  getChannelConfig,
  getChannelName,
  onImport,
  onRestore,
  toast,
}: FileActionsOptions): Record<string, () => void | Promise<void>> {
  const fileName = () => getPreset().name.replace(/[<>:"/\\|?*]/g, '_');
  const chooseFile = (
    accept: string,
    handler: (text: string, name: string, fileName: string) => void | Promise<void>,
  ) => chooseFileWithErrors(accept, handler, toast);
  function doImport(text: string, name: string) {
    const preset = importPreset(text, name);
    onImport(preset);
    $<HTMLDialogElement>('#modal').close();
    toast(`Imported ${preset.name}`);
  }
  return {
    export: () =>
      openModal(
        'Export preset',
        /* HTML */ ` <p>
            Equalizer APO configuration for
            ${getPreset().linked ? 'both linked channels' : `the ${getChannelName()} channel`}. Copy
            it below or download a file.
          </p>
          <label class="config-label" for="export-text">APO configuration</label
          ><textarea
            id="export-text"
            class="config-text"
            rows="10"
            readonly
            spellcheck="false"
            aria-label="APO configuration"
          >
${esc(exportText(getChannelConfig()))}</textarea>
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
          </div>`,
      ),
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
    import: () =>
      openModal(
        'Import preset',
        /* HTML */ ` <p>
            Paste an Equalizer APO configuration below. Import creates a new local preset.
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
            <button class="primary" data-action="import-paste">Import as new preset</button>
          </div>
          <div class="or-divider">or import a file</div>
          <button data-action="import-file" class="wide">${icon('upload')} Choose a file</button>
          <p class="small-text">TOPPING / REW / Equalizer APO TXT, filter CSV, or PEQ JSON.</p>`,
      ),
    'import-file': () => chooseFile('.txt,.json,.csv', (text, name) => doImport(text, name)),
    'import-paste': () => {
      try {
        doImport($<HTMLTextAreaElement>('#import-text').value, 'Imported preset');
      } catch (e) {
        $('#import-error').textContent = String(errorMessage(e));
      }
    },
    backup: () =>
      openModal(
        'Workspace backup',
        '<p>Back up all presets, both channels, and imported response curves.</p><div class="export-options"><button data-action="backup-save">Download backup<small>All workspace data · JSON</small></button><button data-action="backup-restore">Restore backup<small>Replaces this workspace · undo available</small></button></div>',
      ),
    'backup-save': () => {
      download('peq-workspace.json', JSON.stringify(getState(), null, 2), 'application/json');
      $<HTMLDialogElement>('#modal').close();
    },
    'backup-restore': () =>
      chooseFile('.json', (text) => {
        const restored = validateState(JSON.parse(text));
        onRestore(restored);
        $<HTMLDialogElement>('#modal').close();
        toast('Workspace restored.');
      }),
    'close-modal': () => $<HTMLDialogElement>('#modal').close(),
  };
}
