// Runtime guards for every answer of the local HTTP API, used by the web UI and testable from Node. Pure: no Node or DOM APIs.
// A guard takes the `unknown` from `response.json()` and returns the same value, now typed, or a `reason`.
// The reason is built from field names and expected types only, never from response values: they can hold secrets and the reason goes to the console.
import type {
  ApiErrorResponse,
  ClipboardCopyResponse,
  ConfigResponse,
  CountResponse,
  ExportResponse,
  FolderDeleteResponse,
  FolderNameResponse,
  GenerateResponse,
  ImportPreviewResponse,
  ImportResponse,
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

/** The typed value, or why the input was rejected. */
export type GuardResult<T> = { ok: true; value: T } | { ok: false; reason: string };
/** Validates an `unknown` response body. */
export type Guard<T> = (value: unknown) => GuardResult<T>;

// `undefined` means nothing is wrong; otherwise the reason.
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

// Builds a Guard from a predicate and a function that explains a failure.
function guardOf<T>(is: (value: unknown) => value is T, problem: (value: unknown) => Problem): Guard<T> {
  return (value) => (is(value) ? { ok: true, value } : fail(problem(value) ?? 'unexpected shape'));
}

// One field check: [key, description of the expected value, test].
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
/** Narrows to an error body: a string `error`, with optional `key` and `params`. */
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
/** Guards `{ ok: true }`. */
export const guardOkResponse: Guard<OkResponse> = guardOf(isOkResponse, okProblem);

/** Guards the POST /api/shutdown ack. `ApiResponses` types it `undefined` because the handler writes the answer itself, but the body is `{ ok: true }`. */
export const guardShutdownAck: Guard<undefined> = (value) => (isOkResponse(value) ? { ok: true, value: undefined } : fail(okProblem(value) ?? 'unexpected shape'));

const countProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['ok', 'true', isTrue], ['count', 'number', isNumber]]);
function isCountResponse(value: unknown): value is CountResponse {
  return countProblem(value) === undefined;
}
/** Guards `{ ok: true, count }`. */
export const guardCountResponse: Guard<CountResponse> = guardOf(isCountResponse, countProblem);
/** Guards the folder-delete answer, which has the same shape as {@link guardCountResponse}. */
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
/** Guards GET /api/status. */
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
/** Guards GET and PUT /api/config. */
export const guardConfigResponse: Guard<ConfigResponse> = guardOf(isConfigResponse, configProblem);

const folderNameProblem = (value: unknown): Problem => fieldsProblem(value, 'response', [['name', 'string', isString]]);
function isFolderNameResponse(value: unknown): value is FolderNameResponse {
  return folderNameProblem(value) === undefined;
}
/** Guards `{ name }`, the answer to creating or renaming a folder. */
export const guardFolderNameResponse: Guard<FolderNameResponse> = guardOf(isFolderNameResponse, folderNameProblem);

/** Guards GET /api/folders. Returns a fresh mutable copy, since the UI keeps and edits its own list. */
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
/** Guards the SSH generate and inspect answers. */
export const guardSshKeyResponse: Guard<SshKeyResponse> = guardOf(isSshKeyResponse, sshKeyProblem);

const clipboardProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['ok', 'true', isTrue], ['seconds', 'number', isNumber], ['concealed', 'false when present', (v) => v === undefined || v === false]]);
function isClipboardCopyResponse(value: unknown): value is ClipboardCopyResponse {
  return clipboardProblem(value) === undefined;
}
/** Guards the POST /api/clipboard/copy answer. */
export const guardClipboardCopyResponse: Guard<ClipboardCopyResponse> = guardOf(isClipboardCopyResponse, clipboardProblem);

const generateProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['password', 'string', isString], ['bits', 'number', isNumber]]);
function isGenerateResponse(value: unknown): value is GenerateResponse {
  return generateProblem(value) === undefined;
}
/** Guards the POST /api/generate answer. */
export const guardGenerateResponse: Guard<GenerateResponse> = guardOf(isGenerateResponse, generateProblem);

const mergeProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [['added', 'number', isNumber], ['skipped', 'number', isNumber]]);
function isMergeResponse(value: unknown): value is MergeResponse {
  return mergeProblem(value) === undefined;
}
/** Guards the answer to importing a backup. */
export const guardMergeResponse: Guard<MergeResponse> = guardOf(isMergeResponse, mergeProblem);

const warningProblem = (value: unknown, path: string): Problem =>
  fieldsProblem(value, path, [['key', 'string', isString], ['params', 'object', (params) => isTranslateParams(params)]]);
const warningsProblem = (value: unknown): Problem => {
  if (!isUnknownArray(value)) return 'response.warnings: expected array';
  for (const [index, warning] of value.entries()) {
    const problem = warningProblem(warning, `response.warnings[${index}]`);
    if (problem !== undefined) return problem;
  }
  return undefined;
};

const importProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [
    ['added', 'number', isNumber],
    ['skipped', 'number', isNumber],
    ['ignored', 'number', isNumber],
    ['warnings', 'array of warnings', (warnings) => warningsProblem(warnings) === undefined],
  ]);
/** Narrows to the result of a committed import. */
export function isImportResponse(value: unknown): value is ImportResponse {
  return importProblem(value) === undefined;
}
/** Guards the result of a committed import. */
export const guardImportResponse: Guard<ImportResponse> = guardOf(isImportResponse, importProblem);

const previewProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [
    ['count', 'number', isNumber],
    ['ignored', 'number', isNumber],
    ['warnings', 'array of warnings', (warnings) => warningsProblem(warnings) === undefined],
  ]);
/** Narrows to the preview of a dry-run import. */
export function isImportPreviewResponse(value: unknown): value is ImportPreviewResponse {
  return previewProblem(value) === undefined;
}
/** Guards the preview of a dry-run import. */
export const guardImportPreviewResponse: Guard<ImportPreviewResponse> = guardOf(isImportPreviewResponse, previewProblem);

/** Guards POST /api/import, which answers with a preview for a dry run and with the result otherwise. */
export const guardImportAnswer: Guard<ImportResponse | ImportPreviewResponse> = (value) => {
  if (isImportResponse(value) || isImportPreviewResponse(value)) return { ok: true, value };
  return fail(importProblem(value) ?? previewProblem(value) ?? 'unexpected shape');
};

const exportProblem = (value: unknown): Problem =>
  fieldsProblem(value, 'response', [
    ['filename', 'string', isString],
    ['mime', 'string', isString],
    ['text', 'string', isString],
    ['warnings', 'array of warnings', (warnings) => warningsProblem(warnings) === undefined],
  ]);
function isExportResponse(value: unknown): value is ExportResponse {
  return exportProblem(value) === undefined;
}
/** Guards the unencrypted export answer. */
export const guardExportResponse: Guard<ExportResponse> = guardOf(isExportResponse, exportProblem);

// ---- vault items ----
const BASE_STRING_KEYS = ['id', 'name', 'notes', 'folder', 'createdAt', 'updatedAt'] as const;
const TYPED_KEY_GROUPS: readonly (readonly string[])[] = [LOGIN_KEYS, CARD_KEYS, IDENTITY_KEYS, SSH_KEYS];
// GET /api/items leaves these out and sends "has one" flags instead.
const SECRET_KEYS: readonly string[] = ['password', 'totp', 'sshPrivateKey'];

// Explains what is wrong with an item, using the rules of isVaultItem(). For `publicItem`, the three secret fields are replaced by their flags.
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

/** Narrows to an item as GET /api/items sends it: no secrets, plus `hasPassword`, `hasTotp` and `hasSshKey`. */
export function isPublicItem(value: unknown): value is PublicItem {
  return itemProblem(value, 'item', true) === undefined;
}

/** Guards a full item (GET /api/items/:id, POST and PUT /api/items). It is the same object, narrowed; unknown extra properties stay on it. */
export const guardVaultItem: Guard<VaultItem> = guardOf(isVaultItem, (value) => itemProblem(value, 'item', false));

/** Guards GET /api/items: the list without secrets. */
export const guardPublicItems: Guard<PublicItem[]> = (value) => {
  if (!isUnknownArray(value)) return fail('items: expected array');
  const items: PublicItem[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isPublicItem(entry)) return fail(itemProblem(entry, `items[${index}]`, true) ?? `items[${index}]: unexpected shape`);
    items.push(entry);
  }
  return { ok: true, value: items };
};

// ---- translation dictionaries (GET /locales/<lang>.json, a static file rather than an /api route) ----
function isDict(value: unknown): value is Dict {
  return isObjectLike(value) && !Array.isArray(value) && Object.values(value).every(isString);
}
/** Guards a locale file: a flat object of strings. */
export const guardDict: Guard<Dict> = (value) => {
  if (isDict(value)) return { ok: true, value };
  if (!isObjectLike(value) || Array.isArray(value)) return fail('dictionary: expected object');
  const bad = Object.entries(value).find(([, entry]) => !isString(entry));
  return fail(bad === undefined ? 'dictionary: unexpected shape' : `dictionary.${bad[0]}: expected string`);
};
