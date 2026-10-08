import test from 'node:test';
import assert from 'node:assert/strict';
import { openModal } from '../src/ui/dialog.ts';

test('backdrop dismissal protects drafts and inside-to-outside selection gestures', (t) => {
  let open = false;
  let boundsReads = 0;
  const dialog = {
    onpointerdown: null as ((event: MouseEvent) => void) | null,
    onpointercancel: null as (() => void) | null,
    onclick: null as ((event: MouseEvent) => void) | null,
    showModal() {
      open = true;
    },
    close() {
      open = false;
    },
    getBoundingClientRect() {
      boundsReads++;
      return { left: 100, top: 100, right: 500, bottom: 500 };
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: (selector: string) => (selector === '#modal' ? dialog : { innerHTML: '' }),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const event = (target: unknown, x: number, button = 0) =>
    ({ target, clientX: x, clientY: 200, button }) as MouseEvent;
  const outside = event(dialog, 50);
  const clickOutside = () => {
    dialog.onpointerdown!(outside);
    dialog.onclick!(outside);
  };
  let draft = '';
  const showImport = () => openModal('Import', '', { dismissOnOutside: () => !draft.trim() });
  showImport();
  draft = 'Preamp: -5 dB';
  clickOutside();
  assert.equal(open, true);
  draft = ' \n ';
  clickOutside();
  assert.equal(open, false);

  showImport();
  boundsReads = 0;
  dialog.onpointerdown!(event({}, 200));
  dialog.onclick!(event({}, 200));
  assert.equal(boundsReads, 0, 'ordinary content clicks must not measure dialog layout');
  dialog.onpointerdown!(event({}, 200));
  dialog.onclick!(outside);
  assert.equal(open, true, 'text selection ending outside must not dismiss');
  dialog.onpointerdown!(event(dialog, 110));
  dialog.onclick!(event(dialog, 110));
  assert.equal(open, true, 'dialog padding is inside');
  dialog.onpointerdown!(outside);
  dialog.onpointercancel!();
  dialog.onclick!(outside);
  assert.equal(open, true);
  dialog.onpointerdown!(event(dialog, 50, 2));
  dialog.onclick!(event(dialog, 50, 2));
  assert.equal(open, true);
  clickOutside();
  assert.equal(open, false);
});
