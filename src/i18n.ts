// Node side of i18n: loads locales/*.json, resolves the language and persists the preference.
// The preference lives in <home>/config.json, OUTSIDE the encrypted vault: the unlock screen
// must render in the right language before the master password is typed.
import { readFileSync, promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { coded } from './errors.js';
import { isObjectLike } from './shared/guards.js';
import { SUPPORTED, resolveLang, normalizeLang, createT, errText, isLang, type Dict, type Dicts, type ResolvedLang, type Translator } from './shared/i18n.js';

export { SUPPORTED, resolveLang, normalizeLang, errText };
export const LOCALES_DIR = new URL('../locales/', import.meta.url);

// A locale file is a flat { key: text } object. It ships inside the package, so anything else means a broken install.
function isDict(value: unknown): value is Dict {
  return isObjectLike(value) && !Array.isArray(value) && Object.values(value).every((text) => typeof text === 'string');
}

function readDict(lang: string): Dict {
  const parsed: unknown = JSON.parse(readFileSync(new URL(`${lang}.json`, LOCALES_DIR), 'utf8'));
  if (!isDict(parsed)) throw coded('err.internal.invalid', `Internal error: invalid locale file ${lang}.json.`, { what: `locale file ${lang}.json` });
  return parsed;
}

let cache: Dicts | undefined;
export function loadDicts(): Dicts {
  cache ??= Object.fromEntries(SUPPORTED.map((l): [string, Dict] => [l, readDict(l)]));
  return cache;
}

export const translator = (lang: string): Translator => createT(lang, loadDicts());

export function systemLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

export const configPath = (home: string): string => join(home, 'config.json');

// Missing or unreadable config -> {}. Never throws: a broken config must not block the vault.
export function readConfig(home: string): Readonly<Record<string, unknown>> {
  try {
    const cfg: unknown = JSON.parse(readFileSync(configPath(home), 'utf8'));
    return isObjectLike(cfg) && !Array.isArray(cfg) ? cfg : {};
  } catch {
    return {};
  }
}

// Only called when the person chooses a language. Keeps every other field of the file.
export async function saveLang(home: string, lang: string): Promise<Readonly<Record<string, unknown>>> {
  if (!isLang(lang)) throw new RangeError(`Unsupported language: ${lang}`);
  const path = configPath(home);
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // A config that exists but doesn't parse is set aside, not silently overwritten.
  const raw = await fs.readFile(path, 'utf8').catch(() => null);
  if (raw !== null) {
    let ok = false;
    try { const v: unknown = JSON.parse(raw); ok = isObjectLike(v) && !Array.isArray(v); } catch {}
    if (!ok) {
      const aside = `${path}.bak-${Date.now()}`;
      await fs.rename(path, aside);
      console.error(`nullbrand: ${path} was not valid JSON; kept as ${aside} and replaced.`);
    }
  }
  const next = { ...readConfig(home), lang };
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, path);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  return next;
}

export interface ProcessLangOptions {
  flag?: unknown;
  home?: string | undefined;
  env?: NodeJS.ProcessEnv;
  system?: unknown;
}

// Full resolution for a process: flag > NULLBRAND_LANG > config.json > system locale > en.
export function resolveForProcess({ flag, home, env = process.env, system = systemLocale() }: ProcessLangOptions = {}): ResolvedLang {
  // Without a data directory there is no config file to read: before, path.join(undefined, ...) threw inside readConfig's try and the
  // config was simply ignored ("never throws"), which is exactly what this does.
  const config = home === undefined ? undefined : readConfig(home)['lang'];
  return resolveLang({ flag, env: env.NULLBRAND_LANG, config, system });
}
