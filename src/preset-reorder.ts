import { eventElement } from './dom.ts';
export function installPresetReordering(
  root: HTMLElement,
  onMove: (id: string, targetId: string, after: boolean) => void,
) {
  let drag: {
    handle: HTMLElement;
    id: string;
    pointer: number;
    startX: number;
    startY: number;
    target: HTMLElement | null;
    after: boolean;
  } | null = null;
  const clear = () =>
    root
      .querySelectorAll<HTMLElement>('.drop-before,.drop-after,.is-dragging')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'is-dragging'));
  root.addEventListener('pointerdown', (event) => {
    const handle = eventElement(event).closest<HTMLElement>('[data-reorder]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    drag = {
      handle,
      id: handle.dataset.reorder!,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target: null,
      after: false,
    };
  });
  root.addEventListener('pointermove', (event) => {
    if (
      !drag ||
      drag.pointer !== event.pointerId ||
      Math.hypot(event.clientY - drag.startY, event.clientX - drag.startX) < 5
    )
      return;
    clear();
    drag.handle.closest('.preset-row')!.classList.add('is-dragging');
    const horizontal = getComputedStyle(root).display === 'flex',
      bounds = root.getBoundingClientRect();
    if (horizontal) {
      if (event.clientX < bounds.left + 28) root.scrollLeft -= 12;
      else if (event.clientX > bounds.right - 28) root.scrollLeft += 12;
    } else {
      if (event.clientY < bounds.top + 28) root.scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 28) root.scrollTop += 12;
    }
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-preset-id]');
    drag.target = row && root.contains(row) && row.dataset.presetId !== drag.id ? row : null;
    if (!drag.target) return;
    const rect = drag.target.getBoundingClientRect();
    drag.after = horizontal
      ? event.clientX > rect.left + rect.width / 2
      : event.clientY > rect.top + rect.height / 2;
    drag.target.classList.add(drag.after ? 'drop-after' : 'drop-before');
  });
  function finish(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const { handle, id, target, after } = drag;
    drag = null;
    clear();
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (event.type === 'pointerup' && target) {
      onMove(id, target.dataset.presetId!, after);
      Array.from(root.querySelectorAll<HTMLElement>('[data-reorder]'))
        .find((el) => el.dataset.reorder === id)
        ?.focus();
    }
  }
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  root.addEventListener('keydown', (event) => {
    const handle = eventElement(event).closest<HTMLElement>('[data-reorder]');
    if (!handle) return;
    if (event.key === 'Escape' && drag) {
      const active = drag;
      drag = null;
      clear();
      if (active.handle.hasPointerCapture(active.pointer))
        active.handle.releasePointerCapture(active.pointer);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-preset-id]')),
      index = rows.findIndex((row) => row === handle.closest('.preset-row'));
    const after = ['ArrowDown', 'ArrowRight'].includes(event.key),
      target = rows[index + (after ? 1 : -1)];
    if (!target) return;
    const id = handle.dataset.reorder!;
    onMove(id, target.dataset.presetId!, after);
    Array.from(root.querySelectorAll<HTMLElement>('[data-reorder]'))
      .find((el) => el.dataset.reorder === id)
      ?.focus();
  });
}
