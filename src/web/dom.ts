// DOM access helpers; nothing here touches the document at import time.
// The HTML is the app's own, so a missing or unexpected element is a bug: these helpers throw instead of silently doing nothing.
/** A required element is missing or is not the expected kind. */
export class DomError extends Error {
  constructor(what: string) {
    super(`nullbrand: missing or unexpected DOM node: ${what}`);
    this.name = 'DomError';
  }
}
type Class<T> = { new (...args: never[]): T; prototype: T };
/**
 * Narrows `value` with `instanceof`, avoiding type assertions.
 * @param what names the node in the error message.
 * @throws {DomError} when `value` is not a `kind`.
 */
export function expectInstance<T>(value: unknown, kind: Class<T>, what: string): T {
  if (value instanceof kind) return value;
  throw new DomError(what);
}
/** Finds the first match under `root`. @throws {DomError} when missing or not a `kind`. */
export const query = <T extends Element>(root: ParentNode, selector: string, kind: Class<T>): T => expectInstance(root.querySelector(selector), kind, selector);
/** Finds every match under `root`. @throws {DomError} when any is not a `kind`. */
export const queryAll = <T extends Element>(root: ParentNode, selector: string, kind: Class<T>): T[] =>
  [...root.querySelectorAll(selector)].map((node) => expectInstance(node, kind, selector));
/** Finds an element in the document. @throws {DomError} when missing. */
export const $ = (sel: string): HTMLElement => query(document, sel, HTMLElement);
/** Like {@link $} for an `<input>`. */
export const $input = (sel: string): HTMLInputElement => query(document, sel, HTMLInputElement);
/** Like {@link $} for a `<textarea>`. */
export const $textarea = (sel: string): HTMLTextAreaElement => query(document, sel, HTMLTextAreaElement);
/** Like {@link $} for a `<button>`. */
export const $button = (sel: string): HTMLButtonElement => query(document, sel, HTMLButtonElement);
/** Like {@link $} for a `<dialog>`. */
export const $dialog = (sel: string): HTMLDialogElement => query(document, sel, HTMLDialogElement);
/** Like {@link $} for a `<form>`. */
export const $form = (sel: string): HTMLFormElement => query(document, sel, HTMLFormElement);

/** A value the HTML always provides is missing or unexpected. */
export class DomValueError extends Error {
  constructor(what: string) {
    super(`nullbrand: unexpected value: ${what}`);
    this.name = 'DomValueError';
  }
}
/** Reads a `data-*` attribute that the HTML always sets. @throws {DomValueError} when absent. */
export function data(node: HTMLElement, name: string): string {
  const value = node.dataset[name];
  if (value === undefined) throw new DomValueError(`missing data-${name}`);
  return value;
}
/** Returns `value` typed as one of `allowed`. @throws {DomValueError} otherwise. */
export function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new DomValueError(`${what} is not one of the expected values`);
  return found;
}
/** Combines {@link data} and {@link oneOf}. */
export const dataOneOf = <T extends string>(node: HTMLElement, name: string, allowed: readonly T[]): T => oneOf(data(node, name), allowed, `data-${name}`);
/** Returns `textContent`, which is `string | null` for any Node but always a string for this page's elements. */
export function textOf(node: HTMLElement): string {
  const text = node.textContent;
  if (text === null) throw new DomValueError('textContent is null');
  return text;
}
/** Returns `items[index]` for an index known to be in range. @throws {DomValueError} if it is not. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new DomValueError('index out of range');
  return item;
}
/** Returns whether an event target is a node inside `root`. */
export const containsTarget = (root: Node, target: EventTarget | null): boolean => target instanceof Node && root.contains(target);
/** Returns the first file chosen in a file input, if any. */
export function firstFile(input: HTMLInputElement): File | undefined {
  const files = input.files;
  if (files === null) throw new DomValueError('file input without a file list');
  return files[0];
}

type Child = Node | string | null | undefined;
// Properties for a new element: any of its own, except that `style` may be CSS text and `textContent` a number (the DOM converts both).
type ElementProps<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'textContent'>> & { style?: string; textContent?: string | number };
/** Creates an element with the given properties and children; `null` and `undefined` children are skipped. */
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps<K> = {}, ...children: Child[]): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
};
/** Creates a `<span data-i18n>` placeholder that `applyI18n` fills. */
export const tx = (key: string): HTMLSpanElement => { const n = document.createElement('span'); n.dataset['i18n'] = key; return n; };
