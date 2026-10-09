/** Press and slide over controls; the stable root keeps capture across rerenders. */
export function installPressSlide(
  root: HTMLElement,
  selector: string,
  keyOf: (button: HTMLElement) => string,
  onPress: (button: HTMLElement, group: symbol, first: boolean) => void,
) {
  let drag: { id: number; key: string; group: symbol } | null = null;
  let suppressClick = false;
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
    const button =
      event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
    if (!button || button.matches(':disabled')) return;
    event.preventDefault();
    drag = { id: event.pointerId, key: keyOf(button), group: Symbol('press-slide') };
    root.setPointerCapture(event.pointerId);
    onPress(button, drag.group, true);
  });
  root.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      finish();
      return;
    }
    const button = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(selector);
    if (!button || !root.contains(button) || button.matches(':disabled')) return;
    const key = keyOf(button);
    if (key === drag.key) return;
    drag.key = key;
    onPress(button, drag.group, false);
  });
  function finish(event?: PointerEvent) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
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
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}
