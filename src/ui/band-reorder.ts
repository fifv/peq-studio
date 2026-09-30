/** Dedicated grips leave numeric dragging and horizontal rail scrolling intact. */
export function installBandReordering(
  root: HTMLElement,
  onMove: (from: number, to: number) => void,
) {
  let drag: {
    handle: HTMLElement;
    pointer: number;
    from: number;
    to: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
  } | null = null;
  let frame = 0;
  let suppressClick = false;
  const cards = () => [...root.querySelectorAll<HTMLElement>('[data-band-card]')];
  const clearMarkers = () =>
    cards().forEach((card) => card.classList.remove('reorder-before', 'reorder-after'));
  function updateTarget() {
    if (!drag) return;
    clearMarkers();
    drag.to = drag.from;
    const target = document
      .elementFromPoint(drag.x, drag.y)
      ?.closest<HTMLElement>('[data-band-card]');
    if (!target || !root.contains(target)) return;
    const index = Number(target.dataset.bandCard);
    if (index === drag.from) return;
    const rect = target.getBoundingClientRect();
    const after = drag.x > rect.left + rect.width / 2;
    const insertion = index + Number(after);
    drag.to = insertion - Number(drag.from < insertion);
    target.classList.add(after ? 'reorder-after' : 'reorder-before');
  }
  function autoScroll() {
    if (!drag?.active) return;
    const rect = root.getBoundingClientRect();
    if (root.scrollWidth > root.clientWidth && drag.y >= rect.top && drag.y <= rect.bottom) {
      const direction = drag.x < rect.left + 28 ? -1 : drag.x > rect.right - 28 ? 1 : 0;
      if (direction) {
        root.scrollLeft += direction * 8;
        updateTarget();
      }
    }
    frame = requestAnimationFrame(autoScroll);
  }
  root.addEventListener('pointerdown', (event) => {
    const handle =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-band-reorder]')
        : null;
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    const from = Number(handle.dataset.bandReorder);
    drag = {
      handle,
      pointer: event.pointerId,
      from,
      to: from,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
  });
  root.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
      drag.active = true;
      drag.handle.closest('.band-card')!.classList.add('reordering');
      root.classList.add('reordering-bands');
      frame = requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    updateTarget();
  });
  function finish(apply: boolean) {
    if (!drag) return;
    const { handle, pointer, from, to, active } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    clearMarkers();
    root.classList.remove('reordering-bands');
    handle.closest('.band-card')?.classList.remove('reordering');
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    suppressClick = active;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    if (apply && active && from !== to) {
      onMove(from, to);
      root
        .querySelector<HTMLElement>(`[data-band-reorder="${to}"]`)
        ?.focus({ preventScroll: true });
    }
  }
  root.addEventListener('pointerup', (event) => {
    if (drag?.pointer === event.pointerId) finish(true);
  });
  root.addEventListener('pointercancel', () => finish(false));
  root.addEventListener('lostpointercapture', () => finish(false));
  window.addEventListener('blur', () => finish(false));
  document.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    },
    true,
  );
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      finish(false);
      return;
    }
    const handle =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-band-reorder]')
        : null;
    if (!handle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const from = Number(handle.dataset.bandReorder);
    const to = from + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1);
    if (to < 0 || to >= cards().length) return;
    onMove(from, to);
    root.querySelector<HTMLElement>(`[data-band-reorder="${to}"]`)?.focus();
  });
}
