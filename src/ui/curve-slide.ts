import { clamp } from '../utils.ts';

/** Slide within curve rows or collection tabs; grips remain dedicated to reordering. */
export function installCurveSlide(
  root: HTMLElement,
  onSelect: (id: string) => void,
  onCollection?: (id: string) => void,
) {
  const events = new AbortController();
  const options = { signal: events.signal };
  let drag: {
    pointer: number;
    x: number;
    y: number;
    selected: string;
    collection: boolean;
    group: symbol;
  } | null = null;
  let frame = 0;
  let suppressClick = false;
  function select(id: string) {
    if (!drag || drag.selected === id) return;
    drag.selected = id;
    if (drag.collection) onCollection?.(id);
    else onSelect(id);
  }
  function track() {
    frame = 0;
    if (!drag) return;
    if (drag.collection) {
      const tab = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('[data-view]');
      if (tab && root.contains(tab)) select(tab.dataset.view!);
      return;
    }
    const list = root.querySelector('.curve-list');
    if (!list) return;
    const rect = list.getBoundingClientRect();
    if (drag.x < rect.left || drag.x > rect.right) return;
    const speed = drag.y < rect.top + 24 ? -6 : drag.y > rect.bottom - 24 ? 6 : 0;
    const before = list.scrollTop;
    list.scrollTop += speed;
    const choice = document
      .elementFromPoint(drag.x, clamp(drag.y, rect.top + 4, rect.bottom - 4))
      ?.closest<HTMLElement>('.curve-choice');
    if (choice && root.contains(choice)) select(choice.dataset.curveId!);
    if (speed && list.scrollTop !== before) frame = requestAnimationFrame(track);
  }
  function finish(event?: PointerEvent) {
    if (!drag || (event && event.pointerId !== drag.pointer)) return;
    const { pointer, collection } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    frame = 0;
    root.classList.remove('slide-selecting');
    if (root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer);
    root
      .querySelector<HTMLElement>(
        collection ? '[data-view][aria-selected="true"]' : '.curve-choice[aria-pressed="true"]',
      )
      ?.focus({ preventScroll: true });
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || event.pointerType !== 'mouse' || drag) return;
      const choice =
        event.target instanceof Element ? event.target.closest<HTMLElement>('.curve-choice') : null;
      const tab =
        onCollection && event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-view]')
          : null;
      if (!choice && !tab) return;
      event.preventDefault();
      suppressClick = false;
      drag = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        selected: '',
        collection: !!tab,
        group: Symbol('curve-slide'),
      };
      // Selection redraws rows; capture on the stable popup instead of the button.
      root.setPointerCapture(event.pointerId);
      root.classList.add('slide-selecting');
      select(tab ? tab.dataset.view! : choice!.dataset.curveId!);
    },
    options,
  );
  root.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerId !== drag?.pointer) return;
      if (!(event.buttons & 1)) {
        finish();
        return;
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!frame) track();
    },
    options,
  );
  root.addEventListener('pointerup', finish, options);
  root.addEventListener('pointercancel', finish, options);
  root.addEventListener('lostpointercapture', finish, options);
  window.addEventListener('blur', () => finish(), options);
  root.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { ...options, capture: true },
  );
  return {
    get group() {
      return drag?.group;
    },
    get active() {
      return drag !== null;
    },
    dispose() {
      finish();
      events.abort();
    },
  };
}
