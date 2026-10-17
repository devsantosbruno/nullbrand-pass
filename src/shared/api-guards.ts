// Runtime guards for every answer of the local HTTP API, used by the web UI (and testable from Node). Pure: no Node or DOM APIs.
// Each guard takes the `unknown` that came out of `response.json()` and either hands back the SAME value, now typed, or a `reason`.
// The reason is built only from field names and the expected type, NEVER from values of the response (it can hold secrets and it
// goes to the console). The types are the ones of ./api.ts and ./vault-types.ts.
import type {
  ApiErrorResponse,
  BitwardenImportResponse,
  ClipboardCopyResponse,
  ConfigResponse,
  CountResponse,
  FolderDeleteResponse,
  FolderNameResponse,
  GenerateResponse,
  MergeResponse,
  OkResponse,
  PublicItem,
  SshKeyResponse,
  StatusResponse,
} from './api.js';
import { isObjectLike, isStringArray, isUnknownArray } from './guards.js';
import { isLang, isTranslateParams } from './i18n.js';
import type { Dict, Lang, LangSource } from './i18n.js';
import { CARD_KEYS, IDENTITY_KEYS, ITEM_TYPES, LOGIN_KEYS, SSH_KEYS, isItemType, isVaultItem, ownedKeys } from './vault-types.js';
import type { VaultItem } from './vault-types.js';

export type GuardResult<T> = { ok: true; value: T } | { ok: false; reason: string };
export type Guard<T> = (value: unknown) => GuardResult<T>;

// undefined = nothing wrong; otherwise the reason (field names and expected types only).
type Problem = string | undefined;

const LANG_SOURCES = ['flag', 'env', 'config', 'system', 'default'] as const satisfies readonly LangSource[];

function isLangSource(value: unknown): value is LangSource {
  return LANG_SOURCES.some((source) => source === value);
}
function isLangValue(value: unknown): value is Lang {
  return typeof value === 'string' && isLang(value);
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

// Builds a Guard from a hand-written predicate and the function that says what is wrong when the predicate fails.
function guardOf<T>(is: (value: unknown) => value is T, problem: (value: unknown) => Problem): Guard<T> {
  return (value) => (is(value) ? { ok: true, value } : fail(problem(value) ?? 'unexpected shape'));
}

// Checks `fields` of an object: [key, expected description, test].
type FieldCheck = readonly [key: string, expected: string, test: (value: unknown) => boolean];
function fieldsProblem(value: unknown, path: string, checks: readonly FieldCheck[]): Problem {
  if (!isObjectLike(value) || Array.isArray(value)) return `${path}: expected object`;
  for (const [key, expected, test] of checks) {
    if (!test(Object.hasOwn(value, key) ? value[key] : undefined)) return `${path}.${key}: expected ${expected}`;
  }
  return undefined;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isTrue = (value: unknown): value is true => value === true;

// ---- error answers ----
// An error answer has a string `error`; `key` and `params` are optional. Anything else is not an error body.
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (!isObjectLike(value) || Array.isArray(value)) return false;
  if (typeof value['error'] !== 'string') return false;
  const key = value['key'];
  if (key !== undefined && typeof key !== 'string') return false;
  const params = value['params'];
  return params === undefined || isTranslateParams(params);
}

// ---- simple answers ----
const okProblem = (value: unknown): Problem => fieldsProblem(value, 'response', [['ok', 'true', isTrue]]);
function isOkResponse(value: unknown): value is OkResponse {
  return okProblem(value) === undefined;
}
export const guardOkResponse: Guard<OkResponse> = guardOf(isOkResponse, okProblem);

// POST /api/shutdown: ApiResponses types it `undefined` (the handler writes the answer itself), but what it writes is `{ ok: true }`.
export const guardShutdownAck: Guard<undefined> = (value) => (isOkResponse(value) ? { ok: true, value: undefined } : fail(okProblem(value) ?? 'unexpected shape'));

const countProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['ok', 'true', isTrue], ['count', 'number', isNumber]]);
function isCountResponse(value: unknown): value is CountResponse {
  return countProblem(value) === undefined;
}
export const guardCountResponse: Guard<CountResponse> = guardOf(isCountResponse, countProblem);
export const guardFolderDeleteResponse: Guard<FolderDeleteResponse> = guardOf(isCountResponse, countProblem);

const statusProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'status', [
    ['exists', 'boolean', isBoolean],
    ['unlocked', 'boolean', isBoolean],
    ['vaultPath', 'string', isString],
    ['idleMinutes', 'number', isNumber],
    ['count', 'number or null', (v) => v === null || isNumber(v)],
    ['lang', 'a supported language', isLangValue],
    ['langSource', 'a language source', isLangSource],
  ]);
function isStatusResponse(value: unknown): value is StatusResponse {
  return statusProblem(value) === undefined;
}
export const guardStatusResponse: Guard<StatusResponse> = guardOf(isStatusResponse, statusProblem);

const configProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'config', [
    ['lang', 'a supported language', isLangValue],
    ['source', 'a language source', isLangSource],
    ['supported', 'array of supported languages', (v) => isUnknownArray(v) && v.every(isLangValue)],
  ]);
function isConfigResponse(value: unknown): value is ConfigResponse {
  return configProblem(value) === undefined;
}
export const guardConfigResponse: Guard<ConfigResponse> = guardOf(isConfigResponse, configProblem);

const folderNameProblem = (value: unknown): Problem => fieldsProblem(value, 'response', [['name', 'string', isString]]);
function isFolderNameResponse(value: unknown): value is FolderNameResponse {
  return folderNameProblem(value) === undefined;
}
export const guardFolderNameResponse: Guard<FolderNameResponse> = guardOf(isFolderNameResponse, folderNameProblem);

// GET /api/folders: a list of names. The answer is copied into a fresh mutable array (the UI keeps and edits its own list).
export const guardFolderList: Guard<string[]> = (value) => {
  if (!isStringArray(value)) return fail('folders: expected array of strings');
  return { ok: true, value: [...value] };
};

const sshKeyProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'sshKey', [
    ['algo', "'ed25519' or 'rsa4096'", (v) => v === 'ed25519' || v === 'rsa4096'],
    ['publicKey', 'string', isString],
    ['fingerprint', 'string', isString],
    ['privateKey', 'string', isString],
    ['comment', 'string when present', (v) => v === undefined || isString(v)],
  ]);
function isSshKeyResponse(value: unknown): value is SshKeyResponse {
  return sshKeyProblem(value) === undefined;
}
export const guardSshKeyResponse: Guard<SshKeyResponse> = guardOf(isSshKeyResponse, sshKeyProblem);

const clipboardProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['ok', 'true', isTrue], ['seconds', 'number', isNumber], ['concealed', 'false when present', (v) => v === undefined || v === false]]);
function isClipboardCopyResponse(value: unknown): value is ClipboardCopyResponse {
  return clipboardProblem(value) === undefined;
}
export const guardClipboardCopyResponse: Guard<ClipboardCopyResponse> = guardOf(isClipboardCopyResponse, clipboardProblem);

const generateProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['password', 'string', isString], ['bits', 'number', isNumber]]);
function isGenerateResponse(value: unknown): value is GenerateResponse {
  return generateProblem(value) === undefined;
}
export const guardGenerateResponse: Guard<GenerateResponse> = guardOf(isGenerateResponse, generateProblem);

const mergeProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['added', 'number', isNumber], ['skipped', 'number', isNumber]]);
function isMergeResponse(value: unknown): value is MergeResponse {
  return mergeProblem(value) === undefined;
}
export const guardMergeResponse: Guard<MergeResponse> = guardOf(isMergeResponse, mergeProblem);

const bitwardenProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['added', 'number', isNumber], ['skipped', 'number', isNumber], ['ignored', 'number', isNumber]]);
function isBitwardenImportResponse(value: unknown): value is BitwardenImportResponse {
  return bitwardenProblem(value) === undefined;
}
export const guardBitwardenImportResponse: Guard<BitwardenImportResponse> = guardOf(isBitwardenImportResponse, bitwardenProblem);

// ---- vault items ----
const BASE_STRING_KEYS = ['id', 'name', 'notes', 'folder', 'createdAt', 'updatedAt'] as const;
const TYPED_KEY_GROUPS: readonly (readonly string[])[] = [LOGIN_KEYS, CARD_KEYS, IDENTITY_KEYS, SSH_KEYS];
// What GET /api/items leaves out of each item (it sends "has one" flags instead).
const SECRET_KEYS: readonly string[] = ['password', 'totp', 'sshPrivateKey'];

// Says what is wrong with an item, with the same rules as isVaultItem() (secrets included) or, for `publicItem`, the same rules
// minus the three secret fields plus the three flags.
function itemProblem(value: unknown, path: string, publicItem: boolean): Problem {
  if (!isObjectLike(value) || Array.isArray(value)) return `${path}: expected object`;
  const type = value['type'];
  if (!isItemType(type)) return `${path}.type: expected one of ${ITEM_TYPES.join(', ')}`;
  for (const key of BASE_STRING_KEYS) {
    if (typeof value[key] !== 'string') return `${path}.${key}: expected string`;
  }
  if (value['id'] === '') return `${path}.id: expected a non-empty string`;
  if (typeof value['favorite'] !== 'boolean') return `${path}.favorite: expected boolean`;
  const uris = value['uris'];
  if (!isStringArray(uris)) return `${path}.uris: expected array of strings`;
  if (type !== 'login' && uris.length > 0) return `${path}.uris: expected an empty array for a ${type} item`;
  const owned = ownedKeys(type);
  for (const group of TYPED_KEY_GROUPS) {
    for (const key of group) {
      if (publicItem && SECRET_KEYS.includes(key)) continue;
      const field = value[key];
      if (typeof field !== 'string') return `${path}.${key}: expected string`;
      if (!owned.includes(key) && field !== '') return `${path}.${key}: expected an empty string for a ${type} item`;
    }
  }
  if (publicItem) {
    for (const key of ['hasPassword', 'hasTotp', 'hasSshKey'] as const) {
      if (typeof value[key] !== 'boolean') return `${path}.${key}: expected boolean`;
    }
  }
  return undefined;
}

export function isPublicItem(value: unknown): value is PublicItem {
  return itemProblem(value, 'item', true) === undefined;
}

// The full item (GET /api/items/:id, POST /api/items, PUT /api/items/:id). It is the same object, narrowed: unknown extra
// properties stay on it, as they stay on disk.
export const guardVaultItem: Guard<VaultItem> = guardOf(isVaultItem, (value) => itemProblem(value, 'item', false));

// GET /api/items: the list, without the secrets.
export const guardPublicItems: Guard<PublicItem[]> = (value) => {
  if (!isUnknownArray(value)) return fail('items: expected array');
  const items: PublicItem[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isPublicItem(entry)) return fail(itemProblem(entry, `items[${index}]`, true) ?? `items[${index}]: unexpected shape`);
    items.push(entry);
  }
  return { ok: true, value: items };
};

// ---- translation dictionaries (GET /locales/<lang>.json; static files of the package, not an /api route) ----
function isDict(value: unknown): value is Dict {
  return isObjectLike(value) && !Array.isArray(value) && Object.values(value).every(isString);
}
export const guardDict: Guard<Dict> = (value) => {
  if (isDict(value)) return { ok: true, value };
  if (!isObjectLike(value) || Array.isArray(value)) return fail('dictionary: expected object');
  const bad = Object.entries(value).find(([, entry]) => !isString(entry));
  return fail(bad === undefined ? 'dictionary: unexpected shape' : `dictionary.${bad[0]}: expected string`);
};
