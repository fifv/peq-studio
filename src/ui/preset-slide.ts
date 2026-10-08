import { clamp } from '../utils.ts';

/** Mouse selection follows the held pointer; handles and touch scrolling stay independent. */
export function installPresetSlide(root: HTMLElement, onSelect: (id: string) => void) {
  let drag: { pointer: number; x: number; y: number; selected: string } | null = null;
  let frame = 0;
  let suppressClick = false;

  function select(id: string) {
    if (!drag || drag.selected === id) return;
    drag.selected = id;
    onSelect(id);
  }
  function track() {
    frame = 0;
    if (!drag) return;
    const rect = root.getBoundingClientRect();
    const horizontal = getComputedStyle(root).display === 'flex';
    const across = horizontal ? drag.y : drag.x;
    const acrossMin = horizontal ? rect.top : rect.left;
    const acrossMax = horizontal ? rect.bottom : rect.right;
    if (across < acrossMin || across > acrossMax) return;
    const position = horizontal ? drag.x : drag.y;
    const start = horizontal ? rect.left : rect.top;
    const end = horizontal ? rect.right : rect.bottom;
    const speed = position < start + 24 ? -8 : position > end - 24 ? 8 : 0;
    const before = horizontal ? root.scrollLeft : root.scrollTop;
    if (horizontal) root.scrollLeft += speed;
    else root.scrollTop += speed;
    const row = document
      .elementFromPoint(
        clamp(drag.x, rect.left + 4, rect.right - 4),
        clamp(drag.y, rect.top + 4, rect.bottom - 4),
      )
      ?.closest<HTMLElement>('[data-preset-id]');
    if (row && root.contains(row)) select(row.dataset.presetId!);
    const after = horizontal ? root.scrollLeft : root.scrollTop;
    if (speed && before !== after) frame = requestAnimationFrame(track);
  }
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.preset-select[data-id]')
        : null;
    if (!button) return;
    event.preventDefault();
    suppressClick = false;
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, selected: '' };
    // The stable list keeps capture even when selecting rebuilds its rows.
    root.setPointerCapture(event.pointerId);
    root.classList.add('slide-selecting');
    select(button.dataset.id!);
  });
  root.addEventListener('pointermove', (event) => {
    if (drag?.pointer !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      finish();
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!frame) track();
  });
  function finish(event?: PointerEvent) {
    if (!drag || (event && drag.pointer !== event.pointerId)) return;
    const pointer = drag.pointer;
    drag = null;
    cancelAnimationFrame(frame);
    frame = 0;
    root.classList.remove('slide-selecting');
    if (root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer);
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  root.addEventListener('lostpointercapture', finish);
  window.addEventListener('blur', () => finish());
  root.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}
