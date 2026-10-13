import type { Filter } from '../types.ts';

/** Space inverts selected bands, or toggles preamp-only mode when none are selected. */
export function installBandKeyboard(
  root: Document,
  getSelection: () => Filter[],
  commit: (change: () => void) => void,
  togglePreampOnly: () => void,
) {
  root.addEventListener('keydown', (event) => {
    if (
      event.defaultPrevented ||
      event.key !== ' ' ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      root.querySelector('dialog[open]')
    )
      return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="menu"],[role="dialog"]',
      )
    )
      return;
    // Preserve native Space activation on unrelated controls; band-card buttons
    // instead act on the selection, so Space cannot also delete or duplicate.
    if (target.closest('button,a,[role="button"],summary') && !target.closest('[data-band-card]'))
      return;
    const filters = getSelection();
    event.preventDefault();
    if (event.repeat) return;
    if (!filters.length) {
      togglePreampOnly();
      return;
    }
    commit(() => {
      for (const filter of filters) filter.enabled = !filter.enabled;
    });
  });
}
