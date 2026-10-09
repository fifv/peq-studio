import test from 'node:test';
import assert from 'node:assert/strict';
import { installPopupEvents } from '../src/ui/popover.ts';
import { popupTestDom } from './popup-test-dom.ts';

test('pointer-down selection that replaces a popup row is still an inside interaction', (t) => {
  const { node, documentTarget } = popupTestDom(t);
  const popup = node('#popup'),
    anchor = node('#anchor');
  let closed = 0;
  installPopupEvents(
    anchor as unknown as HTMLElement,
    () => popup as unknown as HTMLElement,
    () => {
      closed++;
    },
    () => {},
  );
  const event = new Event('pointerdown');
  // Selection removed the original target, but the dispatched event retains its ancestry.
  Object.defineProperty(event, 'composedPath', {
    value: () => [node('#detached-row'), popup, documentTarget],
  });
  documentTarget.dispatchEvent(event);
  assert.equal(closed, 0);
  documentTarget.dispatchEvent(new Event('pointerdown'));
  assert.equal(closed, 1);
});
