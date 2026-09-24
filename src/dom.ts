/** Required UI nodes fail early with a useful message instead of a null dereference. */
export function query<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode | null = document,
): T {
  if (!root) throw new Error(`Missing UI parent for ${selector}`);
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}
export function eventElement(event: Event): HTMLElement {
  if (!(event.target instanceof Element)) throw new Error('Expected an element event target.');
  return event.target as HTMLElement;
}
