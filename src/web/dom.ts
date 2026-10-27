/**
 * Minimal DOM builder. Text is always inserted as text nodes and attributes via setAttribute,
 * so catalog content (third-party input) can never become markup.
 */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

/** Looks up a required element and verifies its type at runtime. */
export function byId<T extends HTMLElement>(id: string, type: new () => T): T;
export function byId(id: string): HTMLElement;
export function byId(id: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing or invalid #${id}`);
  return element;
}

export function replaceChildren(parent: Element, children: readonly Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}
