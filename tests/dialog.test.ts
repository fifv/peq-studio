import test from 'node:test';
import assert from 'node:assert/strict';
import { openModal } from '../src/ui/dialog.ts';
import { popupTestDom } from './popup-test-dom.ts';

test('nonmodal popups anchor to their trigger and protect drafts during outside interaction', (t) => {
  const { node, documentTarget } = popupTestDom(t);
  const dialog = node('#modal'),
    anchor = node('#import');
  const input = node('#input');
  dialog.children.add(input);
  function pointer(target: unknown, type = 'pointerdown', button = 0) {
    const event = new Event(type);
    Object.defineProperties(event, { target: { value: target }, button: { value: button } });
    documentTarget.dispatchEvent(event);
  }
  let draft = '';
  const show = () =>
    openModal('Import', '', { anchor: '#import', dismissOnOutside: () => !draft.trim() });
  show();
  assert.equal(dialog.open, true);
  assert.equal(dialog.attributes.get('aria-modal'), 'false');
  assert.equal(anchor.attributes.get('aria-expanded'), 'true');
  assert.equal(dialog.style.top, '148px');
  draft = 'Preamp: -5 dB';
  pointer({});
  assert.equal(dialog.open, true);
  draft = ' \n ';
  pointer(input);
  pointer({}, 'pointerup');
  assert.equal(dialog.open, true, 'selection starting inside must not dismiss');
  pointer(anchor);
  assert.equal(dialog.open, true);
  pointer({}, 'pointerdown', 2);
  assert.equal(dialog.open, true);
  pointer({});
  assert.equal(dialog.open, false);
  assert.equal(anchor.attributes.get('aria-expanded'), 'false');
  show();
  const escape = new Event('keydown', { cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  documentTarget.dispatchEvent(escape);
  assert.equal(dialog.open, false);
  assert.equal(anchor.focused, true);
});

test('replacing a popup removes the previous dismissal policy and uses its new anchor', (t) => {
  const { node, documentTarget } = popupTestDom(t);
  openModal('Import', '', { anchor: '#import', dismissOnOutside: false });
  openModal('Export', '', { anchor: '#export' });
  assert.equal(node('#import').attributes.get('aria-expanded'), 'false');
  assert.equal(node('#export').attributes.get('aria-expanded'), 'true');
  const event = new Event('pointerdown');
  Object.defineProperty(event, 'button', { value: 0 });
  documentTarget.dispatchEvent(event);
  assert.equal(node('#modal').open, false);
});
