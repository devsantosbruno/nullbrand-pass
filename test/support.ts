// Small helpers shared by the tests (not a test file: the runner only picks up *.test.js). They exist because the strict compiler
// settings (noUncheckedIndexedAccess, no `!`, no `as`) make "I know this element is there" something a test has to SAY: each helper
// fails the test with an explicit message where the old JavaScript would have thrown a TypeError further down.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { deriveKey, encryptJson } from '../src/crypto.js';
import type { KdfParams } from '../src/crypto.js';
import { toMasterPassword } from '../src/brands.js';
import { isObjectLike, isUnknownArray } from '../src/shared/guards.js';
import { guardDict } from '../src/shared/api-guards.js';
import type { Dict } from '../src/shared/i18n.js';

// list[index], failing the test when there is no such element.
export function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) assert.fail(`expected an element at index ${index} (length ${list.length})`);
  return value;
}

// A value that must not be null / undefined.
export function present<T>(value: T | null | undefined, what: string = 'value'): T {
  if (value === null || value === undefined) assert.fail(`expected ${what} to be present`);
  return value;
}

// A response header that must be there.
export function header(res: { readonly headers: { get(name: string): string | null } }, name: string): string {
  return present(res.headers.get(name), `header ${name}`);
}

// The `key` / `message` of a thrown value of unknown type (undefined when it has none).
export function thrownKey(err: unknown): string | undefined {
  return isObjectLike(err) && typeof err['key'] === 'string' ? err['key'] : undefined;
}
export function thrownMessage(err: unknown): string {
  return isObjectLike(err) && typeof err['message'] === 'string' ? err['message'] : '';
}

// Reads a translation dictionary (locales/<lang>.json) from disk.
export function readDictFile(url: URL): Dict {
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  const result = guardDict(raw);
  if (!result.ok) assert.fail(`${url.pathname}: ${result.reason}`);
  return result.value;
}

// dict[key] for a key the test knows is there (own property), failing the test otherwise.
export function entryOf<T>(dict: Readonly<Record<string, T>>, key: string): T {
  if (!Object.hasOwn(dict, key)) assert.fail(`expected key "${key}"`);
  return present(dict[key], `key "${key}"`);
}

// `await res.json()` for an answer that must be a JSON object (an input boundary: the body arrives as `unknown`).
export async function jsonRecord(res: { json(): Promise<unknown> }): Promise<Readonly<Record<string, unknown>>> {
  const body: unknown = await res.json();
  if (!isObjectLike(body) || Array.isArray(body)) assert.fail('expected the response body to be a JSON object');
  return body;
}

// `params` of a thrown coded error (the object the dictionaries interpolate), failing the test when there is none.
export function thrownParams(err: unknown): Readonly<Record<string, unknown>> {
  const params = isObjectLike(err) ? err['params'] : undefined;
  if (!isObjectLike(params) || Array.isArray(params)) assert.fail('expected the error to carry params');
  return params;
}

// `await res.json()` for an answer that must be a JSON array of objects (the item lists).
export async function jsonRecords(res: { json(): Promise<unknown> }): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const body: unknown = await res.json();
  if (!isUnknownArray(body)) assert.fail('expected the response body to be a JSON array');
  return body.map((entry, index) => {
    if (!isObjectLike(entry) || Array.isArray(entry)) assert.fail(`expected element ${index} of the response to be a JSON object`);
    return entry;
  });
}

// JSON.parse for a text the test wrote or read from disk: the result is an input boundary, so it comes back as `unknown`.
export function parseJson(text: string): unknown {
  const raw: unknown = JSON.parse(text);
  return raw;
}

// A plain, mutable JSON object (the tests edit headers of vault files in place).
export type JsonObject = Record<string, unknown>;
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseJsonObject(text: string): JsonObject {
  const raw = parseJson(text);
  if (!isJsonObject(raw)) assert.fail('expected the text to hold a JSON object');
  return raw;
}
// obj[key] for a key that must hold a JSON object.
export function objectAt(obj: JsonObject, key: string): JsonObject {
  const value = obj[key];
  if (!isJsonObject(value)) assert.fail(`expected "${key}" to hold a JSON object`);
  return value;
}

// Writes a v2 vault file (the current format, the default KDF, so unlocking it does not migrate) whose encrypted payload is `content`.
export async function writeV2Vault(path: string, password: string, content: object): Promise<void> {
  const kdf: KdfParams = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32, salt: randomBytes(16).toString('base64') };
  const aad = ['nullbrand-vault', 2, 'scrypt', kdf.N, kdf.r, kdf.p, 32, kdf.salt].join(':');
  const key = await deriveKey(toMasterPassword(password), kdf);
  const payload = encryptJson(key, content, aad);
  await writeFile(path, JSON.stringify({ format: 'nullbrand-vault', version: 2, kdf, updatedAt: new Date().toISOString(), payload }) + '\n');
  key.fill(0);
}
