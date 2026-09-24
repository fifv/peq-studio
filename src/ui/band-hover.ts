import { query } from '../dom.ts';

/** A transient shared highlight; hovering never changes the selected band. */
export function installBandHover() {
  const rail = query('#bands');
  const chart = query('#chart');
  let hovered: string | undefined;

  function refresh() {
    rail.querySelectorAll<HTMLElement>('[data-band-card]').forEach((card) => {
      card.classList.toggle('is-hovered', card.dataset.bandCard === hovered);
    });
    chart.querySelectorAll<SVGElement>('[data-point]').forEach((point) => {
      point.classList.toggle('is-hovered', point.dataset.point === hovered);
    });
  }
  function update(target: EventTarget | null) {
    const element =
      target instanceof Element
        ? target.closest<HTMLElement | SVGElement>('[data-band-card], [data-point]')
        : null;
    const index = element?.dataset.bandCard ?? element?.dataset.point;
    if (hovered === index) return;
    hovered = index;
    refresh();
  }
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'touch') update(event.target);
  });
  document.addEventListener('pointerout', (event) => {
    if (event.pointerType !== 'touch') update(event.relatedTarget);
  });
  window.addEventListener('blur', () => update(null));

  // Both surfaces replace their children while editing; retain the hover styling.
  const observer = new MutationObserver(refresh);
  observer.observe(rail, { childList: true });
  observer.observe(chart, { childList: true });
}
