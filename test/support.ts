import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deriveKey, encryptJson } from '../src/crypto.js';
import type { KdfParams } from '../src/crypto.js';
import { toMasterPassword } from '../src/brands.js';
import { isObjectLike, isUnknownArray } from '../src/shared/guards.js';
import { guardDict } from '../src/shared/api-guards.js';
import type { Dict } from '../src/shared/i18n.js';

export function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) assert.fail(`expected an element at index ${index} (length ${list.length})`);
  return value;
}

export async function walkFiles(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const name of await readdir(join(dir, prefix))) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if ((await stat(join(dir, rel))).isFile()) files.push(rel);
    else files.push(...(await walkFiles(dir, rel)));
  }
  return files;
}

export function present<T>(value: T | null | undefined, what: string = 'value'): T {
  if (value === null || value === undefined) assert.fail(`expected ${what} to be present`);
  return value;
}

export function header(res: { readonly headers: { get(name: string): string | null } }, name: string): string {
  return present(res.headers.get(name), `header ${name}`);
}

export function thrownKey(err: unknown): string | undefined {
  return isObjectLike(err) && typeof err['key'] === 'string' ? err['key'] : undefined;
}
export function thrownMessage(err: unknown): string {
  return isObjectLike(err) && typeof err['message'] === 'string' ? err['message'] : '';
}

export function readDictFile(url: URL): Dict {
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  const result = guardDict(raw);
  if (!result.ok) assert.fail(`${url.pathname}: ${result.reason}`);
  return result.value;
}

export function entryOf<T>(dict: Readonly<Record<string, T>>, key: string): T {
  if (!Object.hasOwn(dict, key)) assert.fail(`expected key "${key}"`);
  return present(dict[key], `key "${key}"`);
}

export async function jsonRecord(res: { json(): Promise<unknown> }): Promise<Readonly<Record<string, unknown>>> {
  const body: unknown = await res.json();
  if (!isObjectLike(body) || Array.isArray(body)) assert.fail('expected the response body to be a JSON object');
  return body;
}

export function thrownParams(err: unknown): Readonly<Record<string, unknown>> {
  const params = isObjectLike(err) ? err['params'] : undefined;
  if (!isObjectLike(params) || Array.isArray(params)) assert.fail('expected the error to carry params');
  return params;
}

export async function jsonRecords(res: { json(): Promise<unknown> }): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const body: unknown = await res.json();
  if (!isUnknownArray(body)) assert.fail('expected the response body to be a JSON array');
  return body.map((entry, index) => {
    if (!isObjectLike(entry) || Array.isArray(entry)) assert.fail(`expected element ${index} of the response to be a JSON object`);
    return entry;
  });
}

export function parseJson(text: string): unknown {
  const raw: unknown = JSON.parse(text);
  return raw;
}

export type JsonObject = Record<string, unknown>;
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseJsonObject(text: string): JsonObject {
  const raw = parseJson(text);
  if (!isJsonObject(raw)) assert.fail('expected the text to hold a JSON object');
  return raw;
}
export function objectAt(obj: JsonObject, key: string): JsonObject {
  const value = obj[key];
  if (!isJsonObject(value)) assert.fail(`expected "${key}" to hold a JSON object`);
  return value;
}

export async function writeV2Vault(path: string, password: string, content: object): Promise<void> {
  const kdf: KdfParams = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32, salt: randomBytes(16).toString('base64') };
  const aad = ['nullbrand-vault', 2, 'scrypt', kdf.N, kdf.r, kdf.p, 32, kdf.salt].join(':');
  const key = await deriveKey(toMasterPassword(password), kdf);
  const payload = encryptJson(key, content, aad);
  await writeFile(path, JSON.stringify({ format: 'nullbrand-vault', version: 2, kdf, updatedAt: new Date().toISOString(), payload }) + '\n');
  key.fill(0);
}
