import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, newBand } from '../src/model.ts';
import { activePreset } from '../src/utils.ts';
import { createFileActions } from '../src/ui/file-actions.ts';
import { popupTestDom } from './popup-test-dom.ts';

test('export options persist and apply equally to preview, clipboard and TXT download', async (t) => {
  const { node, documentTarget } = popupTestDom(t);
  const storage = new Map<string, string>();
  let copied = '';
  let downloaded: Blob | undefined;
  for (const [key, value] of Object.entries({
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    navigator: {
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      descriptor
        ? Object.defineProperty(globalThis, key, descriptor)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
    downloaded = blob;
    return 'blob:export-test';
  });
  Object.assign(documentTarget, { createElement: () => ({ click() {} }) });
  const state = initialState();
  const preset = activePreset(state);
  preset.left = {
    preampDb: -6,
    filters: [newBand(1000, 2), { ...newBand(2000, -3), enabled: false }],
  };
  const makeActions = () =>
    createFileActions({
      getState: () => state,
      getPreset: () => preset,
      getChannelConfig: () => preset.left,
      getChannelName: () => 'left',
      onImport() {},
      onRestore() {},
      toast() {},
      undoToast() {},
    });
  const actions = makeActions();
  await actions.export();
  assert.match(node('#modal-content').innerHTML, /id="export-include-off-filters"\s+checked/);
  node('#export-include-preamp').checked = true;
  node('#export-include-off-filters').checked = false;
  node('#copy-status').textContent = 'Copied';
  node('#export-include-off-filters').dispatchEvent(new Event('change'));
  assert.match(node('#export-text').value, /Preamp: -6/);
  assert.doesNotMatch(node('#export-text').value, /OFF/);
  assert.equal(node('#copy-status').textContent, '');
  node('#export-include-preamp').checked = false;
  node('#export-include-preamp').dispatchEvent(new Event('change'));
  const preview = node('#export-text').value;
  assert.doesNotMatch(preview, /Preamp:|OFF/);
  await actions['copy-apo']();
  await actions['export-txt']();
  assert.equal(copied, preview);
  assert.equal(await downloaded?.text(), preview);
  assert.equal(storage.get('peq-studio.export-include-off-filters'), 'false');
  await makeActions().export();
  assert.match(node('#modal-content').innerHTML, /id="export-include-off-filters"\s*\/>/);
  assert.doesNotMatch(node('#modal-content').innerHTML, /Preamp:|Filter 2: OFF/);
  node('#export-include-off-filters').checked = true;
  node('#export-include-off-filters').dispatchEvent(new Event('change'));
  assert.match(node('#export-text').value, /Filter 2: OFF/);
  assert.equal(storage.get('peq-studio.export-include-off-filters'), 'true');
});
