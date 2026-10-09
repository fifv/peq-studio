/** Selection modifiers take priority over every action inside a band card. */
export function installBandCardSelection(
  root: HTMLElement,
  onSelect: (index: number, toggle: boolean, range: boolean, rangeStart?: number) => void,
) {
  let drag: { id: number; first: number | null; last: number | null; range: boolean } | null = null;
  let suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  function selectionCard(event: MouseEvent) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey || event.shiftKey)) return null;
    return event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-band-card]')
      : null;
  }
  function selectionBackground(event: MouseEvent) {
    return (
      event.button === 0 &&
      (event.ctrlKey || event.metaKey || event.shiftKey) &&
      event.target instanceof Element &&
      event.target.matches('.band-panel, #bands, #band-editor, .editor-empty')
    );
  }
  // Capture before toggle painting, numeric dragging, rail scrolling, or reordering starts.
  root.addEventListener(
    'pointerdown',
    (event) => {
      suppressClick = false;
      clearTimeout(clickTimer);
      const card = selectionCard(event);
      if (!card && !selectionBackground(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const index = card ? Number(card.dataset.bandCard) : null;
      drag = { id: event.pointerId, first: index, last: index, range: event.shiftKey };
      root.setPointerCapture(event.pointerId);
      if (index !== null) onSelect(index, event.ctrlKey || event.metaKey, event.shiftKey);
    },
    true,
  );
  root.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    if (!(event.buttons & 1)) return finish();
    event.preventDefault();
    const card = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-band-card]');
    const index = card && root.contains(card) ? Number(card.dataset.bandCard) : null;
    if (index === drag.last) return;
    drag.last = index;
    if (index === null) return;
    drag.first ??= index;
    onSelect(index, !drag.range, drag.range, drag.range ? drag.first : undefined);
  });
  function finish(event?: PointerEvent) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
    suppressClick = true;
    clickTimer = setTimeout(() => {
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
      if (suppressClick || drag) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const card = selectionCard(event);
      if (!card && !selectionBackground(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (card)
        onSelect(Number(card.dataset.bandCard), event.ctrlKey || event.metaKey, event.shiftKey);
    },
    true,
  );
  root.addEventListener(
    'dblclick',
    (event) => {
      if (!selectionCard(event) && !selectionBackground(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
