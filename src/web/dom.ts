// DOM access helpers. Only functions: nothing here touches the document at import time.
// The HTML is the app's own, so an element that is not there (or is not what the code expects) is a bug: it throws, it never
// turns into a silent no-op. `instanceof` narrows; there are no type assertions.
export class DomError extends Error {
  constructor(what: string) {
    super(`nullbrand: missing or unexpected DOM node: ${what}`);
    this.name = 'DomError';
  }
}
type Class<T> = { new (...args: never[]): T; prototype: T };
export function expectInstance<T>(value: unknown, kind: Class<T>, what: string): T {
  if (value instanceof kind) return value;
  throw new DomError(what);
}
export const query = <T extends Element>(root: ParentNode, selector: string, kind: Class<T>): T => expectInstance(root.querySelector(selector), kind, selector);
export const queryAll = <T extends Element>(root: ParentNode, selector: string, kind: Class<T>): T[] =>
  [...root.querySelectorAll(selector)].map((node) => expectInstance(node, kind, selector));
export const $ = (sel: string): HTMLElement => query(document, sel, HTMLElement);
export const $input = (sel: string): HTMLInputElement => query(document, sel, HTMLInputElement);
export const $textarea = (sel: string): HTMLTextAreaElement => query(document, sel, HTMLTextAreaElement);
export const $button = (sel: string): HTMLButtonElement => query(document, sel, HTMLButtonElement);
export const $dialog = (sel: string): HTMLDialogElement => query(document, sel, HTMLDialogElement);
export const $form = (sel: string): HTMLFormElement => query(document, sel, HTMLFormElement);

// A data-* attribute that the HTML always sets.
export class DomValueError extends Error {
  constructor(what: string) {
    super(`nullbrand: unexpected value: ${what}`);
    this.name = 'DomValueError';
  }
}
export function data(node: HTMLElement, name: string): string {
  const value = node.dataset[name];
  if (value === undefined) throw new DomValueError(`missing data-${name}`);
  return value;
}
// A string that must be one of a known list.
export function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new DomValueError(`${what} is not one of the expected values`);
  return found;
}
export const dataOneOf = <T extends string>(node: HTMLElement, name: string, allowed: readonly T[]): T => oneOf(data(node, name), allowed, `data-${name}`);
// textContent is `string | null` for any Node; for the elements of this page it is always a string.
export function textOf(node: HTMLElement): string {
  const text = node.textContent;
  if (text === null) throw new DomValueError('textContent is null');
  return text;
}
// arr[index] for an index that is known to be inside the array.
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new DomValueError('index out of range');
  return item;
}
// Node.contains() for the target of an event.
export const containsTarget = (root: Node, target: EventTarget | null): boolean => target instanceof Node && root.contains(target);
// The first file chosen in a file input, if any.
export function firstFile(input: HTMLInputElement): File | undefined {
  const files = input.files;
  if (files === null) throw new DomValueError('file input without a file list');
  return files[0];
}

type Child = Node | string | null | undefined;
// The properties to set on the new element: any of the element's own, except that `style` may be a CSS text and `textContent` a number
// (the DOM converts both).
type ElementProps<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'textContent'>> & { style?: string; textContent?: string | number };
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps<K> = {}, ...children: Child[]): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
};
// <span data-i18n> placeholder, filled by applyI18n.
export const tx = (key: string): HTMLSpanElement => { const n = document.createElement('span'); n.dataset['i18n'] = key; return n; };
