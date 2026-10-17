// i18n core shared by the CLI/server (Node) and the web UI (browser). Pure: no Node or DOM APIs.
// Flat dictionaries (locales/<lang>.json); `{name}` interpolation; plurals via Intl.PluralRules.
import { isObjectLike } from './guards.js';

export const SUPPORTED = Object.freeze(['en', 'pt'] as const);
export type Lang = (typeof SUPPORTED)[number];
export const FALLBACK: Lang = 'en';

export function isLang(value: string): value is Lang {
  return SUPPORTED.some((lang) => lang === value);
}

// 'pt', 'pt-BR', 'pt_BR.UTF-8' -> 'pt'; anything unsupported -> null.
// `value` is `unknown`: it comes straight from a CLI flag, the environment, config.json or an HTTP body.
export function normalizeLang(value: unknown): Lang | null {
  if (typeof value !== 'string') return null;
  const m = /^([a-z]{2,3})(?:[-_.@]|$)/.exec(value.trim().toLowerCase());
  const code = m?.[1];
  return code !== undefined && isLang(code) ? code : null;
}

export type LangSource = 'flag' | 'env' | 'config' | 'system' | 'default';
export interface LangWarning {
  readonly source: 'flag' | 'env';
  readonly value: string;
}
export interface ResolvedLang {
  readonly lang: Lang;
  readonly source: LangSource;
  readonly warnings: LangWarning[];
}
// Every level comes from an input boundary (CLI flag, process.env, config.json, system locale), so each is `unknown`;
// normalizeLang() narrows it.
export interface LangLevels {
  readonly flag?: unknown;
  readonly env?: unknown;
  readonly config?: unknown;
  readonly system?: unknown;
}

// Precedence: flag > env > config file > system locale > 'en'.
// Invalid values are skipped; flag/env ones are reported in `warnings` so the caller can tell the user.
export function resolveLang({ flag, env, config, system }: LangLevels = {}): ResolvedLang {
  const warnings: LangWarning[] = [];
  const levels: readonly (readonly ['flag' | 'env' | 'config' | 'system', unknown])[] = [
    ['flag', flag],
    ['env', env],
    ['config', config],
    ['system', system],
  ];
  for (const [source, value] of levels) {
    if (value === undefined || value === null || value === '') continue;
    const lang = normalizeLang(value);
    if (lang) return { lang, source, warnings };
    if (source === 'flag' || source === 'env') warnings.push({ source, value: String(value) });
  }
  return { lang: FALLBACK, source: 'default', warnings };
}

export type TranslateParams = Readonly<Record<string, string | number | boolean | null | undefined>>;
export type Translator = (key: string, params?: TranslateParams) => string;
export type Dict = Readonly<Record<string, string>>;
export type Dicts = Readonly<Record<string, Dict | undefined>>;

const interpolate = (msg: string, params: TranslateParams): string =>
  msg.replace(/\{(\w+)\}/g, (whole: string, k: string) => {
    const value = params[k];
    return value === undefined || value === null ? whole : String(value);
  });

// dicts: { en: {...}, pt: {...} }. Lookup order: lang -> en -> the key itself.
// Plural: when params.count is a number, `<key>_<category>` is tried before `<key>`.
export function createT(lang: string, dicts: Dicts): Translator {
  const lookup = (l: string, key: string, params: TranslateParams): string | undefined => {
    const dict = dicts[l];
    if (!dict) return undefined;
    const count = params['count'];
    if (typeof count === 'number') {
      const cat = new Intl.PluralRules(l).select(count);
      const byCategory = dict[`${key}_${cat}`];
      if (byCategory !== undefined) return byCategory;
      const other = dict[`${key}_other`];
      if (other !== undefined) return other;
    }
    return dict[key];
  };
  return function t(key: string, params: TranslateParams = {}): string {
    const msg = lookup(lang, key, params) ?? (lang === FALLBACK ? undefined : lookup(FALLBACK, key, params));
    return msg === undefined ? key : interpolate(msg, params);
  };
}

export function fmtDate(lang: string, value: string | number | Date): string {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

// "2 min ago" / "há 2 min". Falls back to the absolute date after a week.
export function fmtRelative(lang: string, value: string | number | Date, now: number = Date.now()): string {
  const diff = Math.round((new Date(value).getTime() - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  // Short style abbreviates with a dot ("2 min. ago"); the dot is dropped to read "2 min ago".
  const fmt = (n: number, unit: Intl.RelativeTimeFormatUnit): string => rtf.format(n, unit).replace(/\.(?=\s|$)/g, '');
  if (abs < 45) return fmt(0, 'second');
  if (abs < 3600) return fmt(Math.round(diff / 60), 'minute');
  if (abs < 86400) return fmt(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return fmt(Math.round(diff / 86400), 'day');
  return fmtDate(lang, value);
}

export function isTranslateParams(value: unknown): value is TranslateParams {
  if (!isObjectLike(value) || Array.isArray(value)) return false;
  return Object.values(value).every((v) => v === undefined || v === null || ['string', 'number', 'boolean'].includes(typeof v));
}

// Translates an error that carries i18n info ({ key, params }); otherwise uses its own message.
// `err` is `unknown`: it is a caught value or the JSON error body of an HTTP response.
export function errText(t: Translator, err: unknown): string {
  if (isObjectLike(err)) {
    const key = err['key'];
    if (typeof key === 'string' && key !== '') {
      const params = err['params'] || {};
      if (isTranslateParams(params)) {
        const msg = t(key, params);
        if (msg !== key) return msg;
      }
    }
    const message = err['message'];
    if (typeof message === 'string' && message !== '') return message;
  }
  return String(err);
}
