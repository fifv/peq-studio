import { query } from '../dom.ts';

const EXPANDED_KEY = 'peq-studio.band-rail.expanded';

/** Horizontal gestures scroll the rail; vertical gestures belong to numeric controls. */
export function installBandRail() {
  const rail = query('#bands');
  const panel = query('.band-panel');
  const editor = query('.editor');
  const toggle = query<HTMLButtonElement>('[data-action="expand-bands"]');
  let drag: {
    id: number;
    x: number;
    y: number;
    scroll: number;
    active: boolean;
  } | null = null;
  let suppressClick = false;

  function setExpanded(expanded: boolean) {
    if (expanded) {
      // Let the page grow for extra rows without taking height away from the graph.
      editor.style.setProperty(
        '--expanded-graph-height',
        `${query('.graph-area').getBoundingClientRect().height}px`,
      );
      panel.style.setProperty(
        '--band-scrollbar-size',
        `${rail.offsetHeight - rail.clientHeight}px`,
      );
    }
    panel.classList.toggle('expanded', expanded);
    rail.toggleAttribute('data-horizontal-scroll', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? 'Collapse' : 'Expand all';
  }
  try {
    setExpanded(localStorage.getItem(EXPANDED_KEY) === 'true');
  } catch {
    // The control remains usable when browser storage is unavailable.
  }
  toggle.addEventListener('click', () => {
    const expanded = !panel.classList.contains('expanded');
    setExpanded(expanded);
    try {
      localStorage.setItem(EXPANDED_KEY, String(expanded));
    } catch {
      // Keep the current session's layout even if the preference cannot be saved.
    }
  });

  rail.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || panel.classList.contains('expanded')) return;
    if (rail.scrollWidth <= rail.clientWidth) return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scroll: rail.scrollLeft,
      active: false,
    };
  });
  document.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag = null;
        return;
      }
      drag.active = true;
      rail.setPointerCapture(event.pointerId);
      rail.classList.add('dragging');
    }
    event.preventDefault();
    rail.scrollLeft = drag.scroll - dx;
  });
  function finish(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    suppressClick = drag.active;
    drag = null;
    rail.classList.remove('dragging');
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
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
}
