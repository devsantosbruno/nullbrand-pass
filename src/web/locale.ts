// The language of the page. Dictionaries come from /locales/<lang>.json (the same files as the CLI). `t` is a stable function that
// always answers in the current language, so it can be passed around; only setLocale() changes what it answers.
import { createT, fmtDate as fmtDateIntl, fmtRelative, FALLBACK } from './i18n.js';
import type { Dict, Lang, TranslateParams, Translator } from './i18n.js';
import { guardDict } from './api-guards.js';
import { DomError, data, el, queryAll } from './dom.js';
import { NOT_JSON, readJson } from './json.js';

const dicts: Record<string, Dict | undefined> = {};
let lang: Lang = FALLBACK;
let translate: Translator = createT(lang, dicts);

export const t: Translator = (key, params) => translate(key, params);
export const getLang = (): Lang => lang;
export function setLocale(next: Lang): void {
  lang = next;
  translate = createT(lang, dicts);
}

export async function loadDicts(): Promise<void> {
  await Promise.all(['en', 'pt'].map(async (l) => {
    try {
      const res = await fetch(`/locales/${l}.json`);
      if (res.ok) {
        const body = await readJson(res);
        const checked = body === NOT_JSON ? ({ ok: false, reason: 'dictionary: not valid JSON' } as const) : guardDict(body);
        if (checked.ok) dicts[l] = checked.value;
        else console.error('nullbrand: invalid response from the local server', { route: `GET /locales/${l}.json`, reason: checked.reason });
      }
    } catch {}
  }));
}

// A copied label in lower case, unless it is an acronym (CPF, CVV).
export const lc = (label: string): string => (label === label.toUpperCase() ? label : label.toLowerCase());

// Replaces "{code}" in a translated string with a <code> element (no innerHTML).
export function setRich(node: HTMLElement, key: string, code: string, params: TranslateParams = {}): void {
  const [before = '', after = ''] = t(key, { ...params, code: '\u0000' }).split('\u0000');
  node.replaceChildren(before, el('code', { textContent: code }), after);
}

// Turns `backtick` spans of a translated string into <code> elements (no innerHTML).
export const rich = (text: string): (string | HTMLElement)[] => text.split('`').map((part, k) => (k % 2 ? el('code', { textContent: part }) : part)).filter((p) => p !== '');

export function applyI18n(root: ParentNode = document): void {
  for (const n of queryAll(root, '[data-i18n]', HTMLElement)) {
    if (n.dataset['i18nCode'] !== undefined) setRich(n, data(n, 'i18n'), data(n, 'i18nCode'));
    else n.replaceChildren(...rich(t(data(n, 'i18n'))));
  }
  for (const n of queryAll(root, '[data-i18n-title]', HTMLElement)) n.title = t(data(n, 'i18nTitle'));
  for (const n of queryAll(root, '[data-i18n-placeholder]', HTMLElement)) {
    if (!(n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement)) throw new DomError('[data-i18n-placeholder] on an element without a placeholder');
    n.placeholder = t(data(n, 'i18nPlaceholder'));
  }
  for (const n of queryAll(root, '[data-i18n-aria]', HTMLElement)) n.setAttribute('aria-label', t(data(n, 'i18nAria')));
  document.documentElement.lang = lang;
  for (const b of queryAll(document, '.lang-switch [data-lang]', HTMLElement)) b.setAttribute('aria-pressed', String(b.dataset['lang'] === lang));
}

export const fmtDate = (iso: string): string => fmtDateIntl(lang, iso);
export const fmtRelativeTime = (iso: string): string => fmtRelative(lang, iso);
