import type { TestContext } from 'node:test';

export class PopupTestNode {
  textContent = '';
  innerHTML = '';
  value = '';
  focused = false;
  selected = false;
  closed = false;
  open = false;
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children = new Set<unknown>();
  offsetHeight = 300;
  scrollHeight = 300;
  onclose?: () => void;
  focus() {
    this.focused = true;
  }
  select() {
    this.selected = true;
  }
  close() {
    this.closed = true;
    this.open = false;
    this.onclose?.();
  }
  show() {
    this.closed = false;
    this.open = true;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  contains(target: unknown) {
    return target === this || this.children.has(target);
  }
  getBoundingClientRect() {
    return { left: 100, top: 100, right: 400, bottom: 140 };
  }
}

export function popupTestDom(t: TestContext) {
  const nodes = new Map<string, PopupTestNode>();
  function node(selector: string) {
    if (!nodes.has(selector)) nodes.set(selector, new PopupTestNode());
    return nodes.get(selector)!;
  }
  const documentTarget = Object.assign(new EventTarget(), { querySelector: node });
  const windowTarget = new EventTarget();
  for (const [key, value] of Object.entries({
    document: documentTarget,
    window: windowTarget,
    innerWidth: 1200,
    innerHeight: 800,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      node('#modal').close();
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  return { node, documentTarget, windowTarget };
}
