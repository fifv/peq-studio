import { query as $ } from '../dom.ts';
import { errorMessage } from '../utils.ts';
import { iconButton as ib } from './icons.ts';
import { positionPopup } from './popover.ts';

let cleanupPopup: (() => void) | undefined;
let popupAnchor: HTMLElement | null = null;
export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function openModal(
  title: string,
  content: string,
  {
    dismissOnOutside = true,
    anchor,
    width = 440,
  }: {
    dismissOnOutside?: boolean | (() => boolean);
    anchor?: string;
    width?: number;
  } = {},
) {
  cleanupPopup?.();
  const dialog = $<HTMLDialogElement>('#modal');
  popupAnchor?.setAttribute('aria-expanded', 'false');
  popupAnchor = anchor ? $(anchor) : popupAnchor;
  const trigger = popupAnchor;
  $('#modal-content').innerHTML = /* HTML */ `<div class="modal-heading">
      <h2 id="action-popup-title">${title}</h2>
      ${ib('close-modal', 'close', 'Close popup')}
    </div>
    ${content}`;
  dialog.setAttribute('aria-labelledby', 'action-popup-title');
  dialog.setAttribute('aria-modal', 'false');
  const position = () => {
    if (dialog.open && trigger) positionPopup(dialog, trigger, { width, flip: true });
  };
  const events = new AbortController();
  const options = { signal: events.signal };
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        dialog.open &&
        event.button === 0 &&
        !dialog.contains(event.target as Node) &&
        !trigger?.contains(event.target as Node) &&
        (typeof dismissOnOutside === 'function' ? dismissOnOutside() : dismissOnOutside)
      )
        dialog.close();
    },
    options,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !dialog.open) return;
      event.preventDefault();
      dialog.close();
      trigger?.focus({ preventScroll: true });
    },
    options,
  );
  window.addEventListener('resize', position, options);
  window.addEventListener('scroll', position, { ...options, capture: true });
  const observer = new ResizeObserver(position);
  observer.observe(dialog);
  cleanupPopup = () => {
    events.abort();
    observer.disconnect();
  };
  dialog.onclose = () => {
    if (dialog.open) return;
    cleanupPopup?.();
    trigger?.setAttribute('aria-expanded', 'false');
  };
  trigger?.setAttribute('aria-haspopup', 'dialog');
  trigger?.setAttribute('aria-controls', 'modal');
  trigger?.setAttribute('aria-expanded', 'true');
  if (!dialog.open) dialog.show();
  position();
}
export function chooseFile(
  accept: string,
  handler: (text: string, name: string, fileName: string) => void | Promise<void>,
  onError: (message: string) => void,
) {
  const input = $<HTMLInputElement>('#file-input');
  input.value = '';
  input.accept = accept;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('Choose a file smaller than 10 MB.');
      await handler(await file.text(), file.name.replace(/\.[^.]+$/, ''), file.name);
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  input.click();
}
