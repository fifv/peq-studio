import { clamp } from '../utils.ts';

interface PopupPlacement {
  width: number;
  align?: 'left' | 'right';
  flip?: boolean;
}

/** Place a nonmodal panel within the viewport, without scrolling its anchor. */
export function positionPopup(
  popup: HTMLElement | null,
  anchor: HTMLElement,
  { width, align = 'right', flip = false }: PopupPlacement,
): void {
  if (!popup) return;
  const inset = 12;
  const gap = 8;
  const bounds = anchor.getBoundingClientRect();
  const panelWidth = Math.min(width, innerWidth - inset * 2);
  popup.style.width = `${panelWidth}px`;
  popup.style.left = `${clamp(align === 'left' ? bounds.left : bounds.right - panelWidth, inset, innerWidth - panelWidth - inset)}px`;
  if (flip) {
    const below = innerHeight - bounds.bottom - inset - gap;
    const above = bounds.top - inset - gap;
    const openBelow = below >= 280 || below >= above;
    const height = Math.max(160, openBelow ? below : above);
    popup.style.maxHeight = `${height}px`;
    popup.style.top = `${openBelow ? bounds.bottom + gap : Math.max(inset, bounds.top - Math.min(popup.scrollHeight, height) - gap)}px`;
  } else {
    popup.style.maxHeight = `${innerHeight - inset * 2}px`;
    popup.style.top = `${clamp(bounds.bottom + gap, inset, Math.max(inset, innerHeight - popup.offsetHeight - inset))}px`;
  }
}

/** One outside-click and positioning policy for every toolbar popup. */
export function installPopupEvents(
  anchor: HTMLElement,
  getPopup: () => HTMLElement | null,
  close: () => void,
  position: () => void,
  canDismiss: () => boolean = () => true,
): void {
  document.addEventListener('pointerdown', (event) => {
    const popup = getPopup();
    if (
      popup &&
      canDismiss() &&
      !popup.contains(event.target as Node) &&
      !anchor.contains(event.target as Node)
    )
      close();
  });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
}
