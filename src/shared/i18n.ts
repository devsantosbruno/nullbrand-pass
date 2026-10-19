// i18n core shared by the CLI/server and the web UI: flat dictionaries, `{name}` interpolation, plurals via Intl.PluralRules. Pure: no Node or DOM APIs.
import { isObjectLike } from './guards.js';

/** Supported language codes. */
export const SUPPORTED = Object.freeze(['en', 'pt'] as const);
export type Lang = (typeof SUPPORTED)[number];
/** Language used when nothing else resolves, and for keys missing from another dictionary. */
export const FALLBACK: Lang = 'en';

/** Narrows a string to a supported language code. */
export function isLang(value: string): value is Lang {
  return SUPPORTED.some((lang) => lang === value);
}

/**
 * Reduces a locale-like value (`pt`, `pt-BR`, `pt_BR.UTF-8`) to a supported code.
 * @param value untrusted: a CLI flag, the environment, config.json or an HTTP body.
 * @returns `null` for anything unsupported.
 */
export function normalizeLang(value: unknown): Lang | null {
  if (typeof value !== 'string') return null;
  const m = /^([a-z]{2,3})(?:[-_.@]|$)/.exec(value.trim().toLowerCase());
  const code = m?.[1];
  return code !== undefined && isLang(code) ? code : null;
}

/** Where the active language came from. */
export type LangSource = 'flag' | 'env' | 'config' | 'system' | 'default';
/** An invalid flag or environment value that was skipped. */
export interface LangWarning {
  readonly source: 'flag' | 'env';
  readonly value: string;
}
/** The outcome of {@link resolveLang}. */
export interface ResolvedLang {
  readonly lang: Lang;
  readonly source: LangSource;
  readonly warnings: LangWarning[];
}
/** Candidate languages by level. All are `unknown` because each comes from an input boundary. */
export interface LangLevels {
  readonly flag?: unknown;
  readonly env?: unknown;
  readonly config?: unknown;
  readonly system?: unknown;
}

/**
 * Picks the language by precedence: flag > env > config file > system locale > `en`.
 * Invalid values are skipped; invalid flag and env ones are reported in `warnings`.
 */
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

/** Values interpolated into a message; `count` also selects the plural form. */
export type TranslateParams = Readonly<Record<string, string | number | boolean | null | undefined>>;
/** Looks up `key` and interpolates `params`; returns the key itself when no dictionary has it. */
export type Translator = (key: string, params?: TranslateParams) => string;
/** One language's flat key-to-text dictionary. */
export type Dict = Readonly<Record<string, string>>;
/** Dictionaries by language code. */
export type Dicts = Readonly<Record<string, Dict | undefined>>;

const interpolate = (msg: string, params: TranslateParams): string =>
  msg.replace(/\{(\w+)\}/g, (whole: string, k: string) => {
    const value = params[k];
    return value === undefined || value === null ? whole : String(value);
  });

/**
 * Builds a {@link Translator}. Lookup order is `lang`, then `en`, then the key itself.
 * When `params.count` is a number, `<key>_<plural category>` and then `<key>_other` are tried before `<key>`.
 */
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

/** Formats a date and time in the short style of `lang`. */
export function fmtDate(lang: string, value: string | number | Date): string {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

/** Formats a time relative to `now` ("2 min ago"), falling back to {@link fmtDate} after a week. */
export function fmtRelative(lang: string, value: string | number | Date, now: number = Date.now()): string {
  const diff = Math.round((new Date(value).getTime() - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  // The short style abbreviates with a dot ("2 min. ago"); drop it.
  const fmt = (n: number, unit: Intl.RelativeTimeFormatUnit): string => rtf.format(n, unit).replace(/\.(?=\s|$)/g, '');
  if (abs < 45) return fmt(0, 'second');
  if (abs < 3600) return fmt(Math.round(diff / 60), 'minute');
  if (abs < 86400) return fmt(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return fmt(Math.round(diff / 86400), 'day');
  return fmtDate(lang, value);
}

/** Narrows to a flat object of primitives that can be interpolated. */
export function isTranslateParams(value: unknown): value is TranslateParams {
  if (!isObjectLike(value) || Array.isArray(value)) return false;
  return Object.values(value).every((v) => v === undefined || v === null || ['string', 'number', 'boolean'].includes(typeof v));
}

/**
 * Translates an error through its `key` and `params`, falling back to its own message and then to `String(err)`.
 * @param err a caught value or the JSON error body of an HTTP response.
 */
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
