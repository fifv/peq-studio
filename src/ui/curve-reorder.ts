/** Pointer capture keeps the grip responsive without selecting a different curve. */
export function installCurveReordering(
  root: HTMLElement,
  onMove: (id: string, targetId: string, after: boolean) => void,
) {
  const events = new AbortController();
  const options = { signal: events.signal };
  let drag: {
    handle: HTMLButtonElement;
    pointer: number;
    id: string;
    targetId: string;
    after: boolean;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
  } | null = null;
  let frame = 0;
  const rows = () => [...root.querySelectorAll<HTMLElement>('[data-custom-curve]')];
  const clearMarkers = () =>
    rows().forEach((row) => row.classList.remove('reorder-before', 'reorder-after', 'reordering'));
  function move(id: string, targetId: string, after: boolean) {
    const list = root.querySelector('.curve-list');
    const scrollTop = list?.scrollTop ?? 0;
    onMove(id, targetId, after);
    if (list) list.scrollTop = scrollTop;
    [...root.querySelectorAll<HTMLButtonElement>('[data-curve-reorder]')]
      .find((handle) => handle.dataset.curveReorder === id)
      ?.focus({ preventScroll: true });
  }
  function updateTarget() {
    if (!drag) return;
    clearMarkers();
    drag.handle.closest('[data-custom-curve]')?.classList.add('reordering');
    drag.targetId = '';
    const target = document
      .elementFromPoint(drag.x, drag.y)
      ?.closest<HTMLElement>('[data-custom-curve]');
    if (!target || !root.contains(target) || target.dataset.customCurve === drag.id) return;
    const rect = target.getBoundingClientRect();
    drag.targetId = target.dataset.customCurve!;
    drag.after = drag.y > rect.top + rect.height / 2;
    target.classList.add(drag.after ? 'reorder-after' : 'reorder-before');
  }
  function autoScroll() {
    if (!drag?.active) return;
    const list = root.querySelector('.curve-list');
    if (list) {
      const rect = list.getBoundingClientRect();
      if (
        drag.x >= rect.left &&
        drag.x <= rect.right &&
        drag.y >= rect.top &&
        drag.y <= rect.bottom
      ) {
        const direction = drag.y < rect.top + 24 ? -1 : drag.y > rect.bottom - 24 ? 1 : 0;
        if (direction) {
          list.scrollTop += direction * 6;
          updateTarget();
        }
      }
    }
    frame = requestAnimationFrame(autoScroll);
  }
  function finish(apply = false) {
    if (!drag) return;
    const { handle, pointer, id, targetId, after, active } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    clearMarkers();
    root.classList.remove('reordering-curves');
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    if (apply && active && targetId) move(id, targetId, after);
  }
  root.addEventListener(
    'pointerdown',
    (event) => {
      const handle =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('[data-curve-reorder]')
          : null;
      if (!handle || handle.disabled || event.button !== 0 || drag) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(event.pointerId);
      drag = {
        handle,
        pointer: event.pointerId,
        id: handle.dataset.curveReorder!,
        targetId: '',
        after: false,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        active: false,
      };
    },
    options,
  );
  root.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!drag.active) {
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
        drag.active = true;
        root.classList.add('reordering-curves');
        frame = requestAnimationFrame(autoScroll);
      }
      event.preventDefault();
      updateTarget();
    },
    options,
  );
  root.addEventListener(
    'pointerup',
    (event) => {
      if (drag?.pointer === event.pointerId) finish(true);
    },
    options,
  );
  root.addEventListener('pointercancel', () => finish(), options);
  root.addEventListener('lostpointercapture', () => finish(), options);
  window.addEventListener('blur', () => finish(), options);
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && drag) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish();
        return;
      }
      const handle =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('[data-curve-reorder]')
          : null;
      if (!handle || handle.disabled || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const visible = rows();
      const id = handle.dataset.curveReorder!;
      const index = visible.findIndex((row) => row.dataset.customCurve === id);
      const after = event.key === 'ArrowDown';
      const target = visible[index + (after ? 1 : -1)];
      if (target) move(id, target.dataset.customCurve!, after);
    },
    options,
  );
  return {
    cancel: () => finish(),
    dispose: () => {
      finish();
      events.abort();
    },
  };
}
