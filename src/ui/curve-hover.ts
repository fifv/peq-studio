import { query } from '../dom.ts';

/** Emphasize an already-visible layer without changing the saved visibility toggles. */
export function installCurveHover() {
  const legend = query('#legend');
  const chart = query('#chart');
  let hovered: string | undefined;

  function refresh() {
    const paths = [...chart.querySelectorAll<SVGElement>('[data-curve-layer]')];
    const chip = [...legend.querySelectorAll<HTMLElement>('[data-layer]')].find(
      (element) => element.dataset.layer === hovered,
    );
    const active =
      chip?.classList.contains('on') && paths.some((path) => path.dataset.curveLayer === hovered);
    paths.forEach((path) => {
      const matches = path.dataset.curveLayer === hovered;
      path.classList.toggle('is-emphasized', Boolean(active && matches));
      path.classList.toggle('is-dimmed', Boolean(active && !matches));
    });
  }
  function update(target: EventTarget | null) {
    const chip = target instanceof Element ? target.closest<HTMLElement>('[data-layer]') : null;
    const next = chip?.dataset.layer;
    if (next === hovered) return;
    hovered = next;
    refresh();
  }
  legend.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'touch') update(event.target);
  });
  legend.addEventListener('pointerout', (event) => {
    if (event.pointerType !== 'touch') update(event.relatedTarget);
  });
  window.addEventListener('blur', () => update(null));
  const observer = new MutationObserver(refresh);
  observer.observe(chart, { childList: true });
  observer.observe(legend, { childList: true });
}
