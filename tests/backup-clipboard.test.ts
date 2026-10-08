import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/model.ts';
import { WorkspaceHistory } from '../src/history.ts';
import { activePreset } from '../src/utils.ts';
import { createFileActions } from '../src/ui/file-actions.ts';

function setup(
  t: TestContext,
  clipboard: { readText(): Promise<string>; writeText(text: string): Promise<void> },
) {
  const nodes = new Map<
    string,
    {
      textContent: string;
      innerHTML: string;
      value: string;
      focused: boolean;
      selected: boolean;
      closed: boolean;
      focus(): void;
      select(): void;
      close(): void;
      showModal(): void;
    }
  >();
  function node(selector: string) {
    if (!nodes.has(selector))
      nodes.set(selector, {
        textContent: '',
        innerHTML: '',
        value: '',
        focused: false,
        selected: false,
        closed: false,
        focus() {
          this.focused = true;
        },
        select() {
          this.selected = true;
        },
        close() {
          this.closed = true;
        },
        showModal() {
          this.closed = false;
        },
      });
    return nodes.get(selector)!;
  }
  for (const [key, value] of Object.entries({
    document: { querySelector: node },
    navigator: { clipboard },
    localStorage: { getItem: () => null },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  let state = initialState();
  const history = new WorkspaceHistory();
  const messages: string[] = [];
  const actions = createFileActions({
    getState: () => state,
    getPreset: () => activePreset(state),
    getChannelConfig: () => activePreset(state).left,
    getChannelName: () => 'left',
    onImport: () => assert.fail('Backup must not use preset import'),
    onRestore: (restored) => {
      history.capture(state);
      state = restored;
    },
    toast: (message) => messages.push(message),
    undoToast: (message) => messages.push(message),
  });
  return { actions, node, messages, history, getState: () => state };
}

test('clipboard backup exports the full workspace and restores it with undo', async (t) => {
  let copied = '';
  const ui = setup(t, {
    readText: async () => copied,
    writeText: async (text) => {
      copied = text;
    },
  });
  const original = structuredClone(ui.getState());
  await ui.actions['backup-copy']();
  assert.deepEqual(JSON.parse(copied), original);
  assert.match(ui.node('#backup-status').textContent, /copied/);
  activePreset(ui.getState()).name = 'Changed after copying';
  const beforeRestore = structuredClone(ui.getState());
  await ui.actions['backup-clipboard']();
  assert.deepEqual(ui.getState(), original);
  assert.equal(ui.node('#modal').closed, true);
  assert.deepEqual(ui.messages, ['Workspace restored.']);
  assert.deepEqual(ui.history.restore(ui.getState(), true), beforeRestore);
});

test('invalid clipboard content never replaces the workspace', async (t) => {
  let text = '';
  const ui = setup(t, { readText: async () => text, writeText: async () => {} });
  const original = structuredClone(ui.getState());
  for (text of ['', 'not JSON', '{"presets": []}', '{"presets": [{}]}']) {
    await ui.actions['backup-clipboard']();
    assert.deepEqual(ui.getState(), original);
    assert.ok(ui.node('#backup-error').textContent);
    assert.equal(ui.node('#modal').closed, false);
    assert.equal(ui.history.canUndo, false);
  }
});

test('blocked clipboard access offers selectable export text and a validated paste restore', async (t) => {
  const denied = async () => {
    throw new Error('Clipboard permission denied');
  };
  const ui = setup(t, { readText: denied, writeText: denied });
  await ui.actions['backup-copy']();
  const backup = ui.node('#backup-text').value;
  assert.deepEqual(JSON.parse(backup), ui.getState());
  assert.equal(ui.node('#backup-text').selected, true);
  assert.match(ui.node('#modal-content').innerHTML, /readonly/);

  await ui.actions['backup-clipboard']();
  assert.match(ui.node('#modal-content').innerHTML, /backup-paste/);
  assert.doesNotMatch(ui.node('#modal-content').innerHTML, /readonly/);
  assert.equal(ui.node('#backup-text').value, '');
  await ui.actions['backup-paste']();
  assert.equal(ui.history.canUndo, false);
  ui.node('#backup-text').value = backup;
  await ui.actions['backup-paste']();
  assert.equal(ui.history.canUndo, true);
  assert.deepEqual(ui.messages, ['Workspace restored.']);
});
