import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, normalizeItem, readBackupItemsFromText } from '../src/vault.js';
import { deriveKey } from '../src/crypto.js';
import type { EncryptedBox, KdfParams } from '../src/crypto.js';
import type { DerivedKey } from '../src/brands.js';
import { toMasterPassword } from '../src/brands.js';
import * as vaultModule from '../src/vault.js';
import * as cryptoModule from '../src/crypto.js';
import { isObjectLike } from '../src/shared/guards.js';
import { at, thrownKey, thrownMessage } from './support.js';
import { planImport } from '../src/formats/index.js';
import { isVaultItem } from '../src/shared/vault-types.js';

const PW = 'test-master-password';
const tmp = () => fs.mkdtemp(join(tmpdir(), 'nb-strict-'));
const FIX = new URL('./fixtures/', import.meta.url);
const FIX_PW = 'fixture-master-password-ñ-123';
interface Failure {
  key: string | undefined;
  params: Readonly<Record<string, unknown>>;
  message: string;
}
const fail = async (promise: Promise<unknown>): Promise<Failure> =>
  promise.then(
    () => assert.fail('expected a rejection'),
    (e: unknown): Failure => {
      const params = isObjectLike(e) ? e['params'] : undefined;
      return { key: thrownKey(e), params: isObjectLike(params) && !Array.isArray(params) ? params : {}, message: thrownMessage(e) };
    },
  );

const looseVault: { unlock(password: unknown, path: string): Promise<unknown> } = Vault;
const looseBackup: { readBackupItemsFromText(text: string, password: unknown): Promise<unknown> } = vaultModule;
const looseCrypto: { encryptJson(key: DerivedKey, value: unknown, aad: string): EncryptedBox } = cryptoModule;

async function vaultWith(dir: string, content: unknown) {
  const kdf: KdfParams = { name: 'scrypt', N: 2 ** 14, r: 8, p: 1, keyLen: 32, salt: Buffer.alloc(16, 7).toString('base64') };
  const aad = ['nullbrand-vault', 2, 'scrypt', kdf.N, kdf.r, kdf.p, 32, kdf.salt].join(':');
  const key = await deriveKey(toMasterPassword(PW), kdf);
  const path = join(dir, `v-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(path, JSON.stringify({ format: 'nullbrand-vault', version: 2, kdf, updatedAt: 'x', payload: looseCrypto.encryptJson(key, content, aad) }) + '\n');
  key.fill(0);
  return path;
}

test('every item of the fixtures satisfies the VaultItem union (all five types)', async () => {
  const v = await Vault.unlock(FIX_PW, new URL('legacy-vault.json', FIX).pathname, { migrate: false });
  assert.deepEqual(v.items.map((i) => i.type).sort(), ['card', 'identity', 'login', 'note', 'ssh']);
  for (const item of v.items) assert.ok(isVaultItem(item), item.type);
  v.key.fill(0);
});

test('isVaultItem rejects an item that holds fields of another type', () => {
  const login = normalizeItem({ type: 'login', name: 'x', username: 'u' });
  assert.ok(isVaultItem(login));
  assert.ok(!isVaultItem({ ...login, cardNumber: '4111' }));
  assert.ok(!isVaultItem({ ...normalizeItem({ type: 'note', name: 'n' }), uris: ['https://a'] }));
  assert.ok(!isVaultItem({ ...login, favorite: 'yes' }));
  assert.ok(!isVaultItem({ ...login, type: 'passkey' }));
  assert.ok(!isVaultItem(null) && !isVaultItem('x'));
});

test('an empty or missing master password is a REJECTION with err.emptyPassword, never a synchronous throw', async () => {
  const dir = await tmp();
  const path = await vaultWith(dir, { items: [] });
  for (const pw of ['', undefined, null, 5]) {
    const promise = looseVault.unlock(pw, path);
    assert.ok(promise instanceof Promise);
    const e = await fail(promise);
    assert.equal(e.key, 'err.emptyPassword', String(pw));
  }
  const text = await fs.readFile(path, 'utf8');
  for (const pw of ['', undefined]) assert.equal((await fail(looseBackup.readBackupItemsFromText(text, pw))).key, 'err.emptyPassword');
  assert.equal((await fail(Vault.create('', join(dir, 'n.json')))).key, 'err.vault.passwordShort');
});

test('add/merge with a truthy non-string id or createdAt is rejected with a typed error and nothing is saved', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  const v = await Vault.create(PW, path);
  const before = await fs.readFile(path);
  for (const bad of [{ createdAt: 123 }, { createdAt: {} }, { createdAt: ['x'] }]) {
    const e = await fail(v.add({ name: 'a', ...bad }));
    assert.equal(e.key, 'err.vault.invalidField');
    assert.equal(e.params['field'], 'createdAt');
  }
  assert.equal((await fail(v.merge([{ name: 'm', type: 'note', createdAt: 1700000000000 }]))).key, 'err.vault.invalidField');
  assert.equal((await fail(Promise.resolve().then(() => normalizeItem({ name: 'x', id: 5 })))).params['field'], 'id');
  assert.deepEqual(await fs.readFile(path), before, 'the vault file was not touched');
  assert.equal(v.items.length, 0);
  const item = await v.add({ name: 'ok', createdAt: '', id: 0 });
  assert.match(item.createdAt, /^\d{4}-/);
  assert.notEqual(item.id, 0);
  v.key.fill(0);
  const again = await Vault.unlock(PW, path);
  assert.equal(again.items.length, 1, 'the vault still opens');
  again.key.fill(0);
});

test('payload shapes: a content that cannot be a vault is refused with a typed error naming the field', async () => {
  const dir = await tmp();
  const cases: readonly (readonly [unknown, string])[] = [[5, 'payload'], ['x', 'payload'], [null, 'payload'], [{ items: 5 }, 'items'], [{ items: null }, 'items'], [{}, 'items'], [{ items: [], folders: null }, 'folders'], [{ items: 'abc' }, 'items'], [{ items: {} }, 'items'], [{ items: [], folders: ['a', 5] }, 'folders'], [{ items: [], folders: [null] }, 'folders']];
  for (const [content, field] of cases) {
    const e = await fail(Vault.unlock(PW, await vaultWith(dir, content), { migrate: false }));
    assert.equal(e.key, 'err.vault.invalidContent', JSON.stringify(content));
    assert.equal(e.params['field'], field);
  }
  const ok = await Vault.unlock(PW, await vaultWith(dir, { items: [{ id: '1', name: 'ok' }], folders: ['a'] }), { migrate: false });
  assert.deepEqual([ok.items.length, ok.folders], [1, ['a']]);
  ok.key.fill(0);
});

test('a file that is JSON but not an object is "not a vault" (null used to be a TypeError)', async () => {
  const dir = await tmp();
  for (const text of ['null', '[]', '"x"', '5', 'true']) {
    const p = join(dir, 'f.json');
    await fs.writeFile(p, text);
    assert.equal((await fail(Vault.unlock(PW, p))).key, 'err.vault.notVault', text);
  }
});

test('backup text: items are normalized like the file path does; unknown types and bad shapes are refused', async () => {
  const dir = await tmp();
  const read = async (content: unknown) => readBackupItemsFromText(await fs.readFile(await vaultWith(dir, content), 'utf8'), PW);
  const item = at(await read({ items: [{ id: '1', name: 'Old', password: 'abc' }] }), 0);
  assert.ok(isVaultItem(item));
  assert.deepEqual([item.type, item.password, item.uris, item.cardNumber], ['login', 'abc', [], '']);
  assert.equal((await fail(read({ items: [{ id: '2', name: 'future', type: 'passkey' }] }))).key, 'err.vault.unknownItemType');
  assert.equal((await fail(read({ items: 'abc' }))).key, 'err.vault.invalidContent');
  assert.equal((await fail(read({ items: [null] }))).key, 'err.vault.invalidItem');
  assert.deepEqual(await read({ folders: [] }), [], 'a backup without items has nothing to import');
  assert.equal((await fail(read({ items: null }))).key, 'err.vault.invalidContent');
  assert.deepEqual(await read({ items: [] }), []);
});

test('import: entries that would have been a TypeError are refused with err.import.invalidEntry', () => {
  for (const exp of [{ items: [], folders: {} }, { items: [], folders: [null] }, { items: [null] }, { items: [{ type: 2, fields: [null] }] }, { items: [{ type: 1, login: { uris: {} } }] }]) {
    assert.throws(() => planImport(JSON.stringify(exp)), (e) => thrownKey(e) === 'err.import.invalidEntry', JSON.stringify(exp));
  }
});

test('import: values that are not text are not text fields (the vault would have blanked them anyway)', () => {
  const { items } = planImport(JSON.stringify({ folders: [{ id: 1, name: 5 }], items: [{ type: 1, name: 123, folderId: 1, creationDate: 1700000000000, login: { username: 5, password: true, uris: [{ uri: 7 }, { uri: 'https://ok' }] } }] }));
  assert.deepEqual(items, [{ name: '(unnamed)', folder: '', favorite: false, createdAt: undefined, type: 'login', username: '', password: '', totp: '', uris: ['https://ok'], notes: '' }]);
  const item = normalizeItem(at(items, 0));
  assert.ok(isVaultItem(item));
});

test('merge is all-or-nothing: an invalid item in the middle leaves memory and file untouched, and a later save does not write the import', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  const v = await Vault.create(PW, path);
  await v.add({ name: 'existing' });
  const itemsBefore = structuredClone(v.items);
  const fileBefore = await fs.readFile(path);
  const batch = [{ type: 'note', name: 'first' }, { type: 'note', name: 'broken', createdAt: 123 }, { type: 'note', name: 'third' }];
  const e = await fail(v.merge(batch));
  assert.equal(e.key, 'err.vault.invalidField');
  assert.deepEqual(v.items, itemsBefore, 'this.items is exactly what it was');
  assert.deepEqual(await fs.readFile(path), fileBefore, 'the file did not change');
  await v.add({ name: 'later' });
  const names = v.items.map((i) => i.name);
  assert.deepEqual(names, ['existing', 'later']);
  v.key.fill(0);
  const reopened = await Vault.unlock(PW, path);
  assert.deepEqual(reopened.items.map((i) => i.name), ['existing', 'later'], 'nothing of the failed import reached the disk');
  reopened.key.fill(0);
});

test('merge still counts duplicates inside the same batch and against the vault', async () => {
  const dir = await tmp();
  const v = await Vault.create(PW, join(dir, 'vault.json'));
  await v.add({ type: 'note', name: 'dup', notes: 'x' });
  const r = await v.merge([{ type: 'note', name: 'dup', notes: 'x' }, { type: 'note', name: 'new', notes: 'y' }, { type: 'note', name: 'new', notes: 'y' }]);
  assert.deepEqual(r, { added: 1, skipped: 2 });
  assert.equal(v.items.length, 2);
  v.key.fill(0);
});

test('add, update, renameFolder, moveMany: when normalizeItem throws, this.items (and the file) are not touched', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  const v = await Vault.create(PW, path);
  const a = await v.add({ name: 'a', folder: 'F' });
  await v.add({ name: 'b', folder: 'F' });
  const state = () => JSON.stringify([v.items, v.folders]);
  const before = state();
  const fileBefore = await fs.readFile(path);
  assert.equal((await fail(v.add({ name: 'x', createdAt: 5 }))).key, 'err.vault.invalidField');
  assert.equal(state(), before);
  at(v.items, 0).createdAt = '';
  const legacyState = state();
  assert.equal((await fail(v.update(a.id, { createdAt: 5 }))).key, 'err.vault.invalidField');
  assert.equal(state(), legacyState);
  at(v.items, 0).createdAt = a.createdAt;
  assert.ok(Reflect.set(at(v.items, 1), 'createdAt', 5));
  const tampered = state();
  const originalFirst = at(v.items, 0);
  assert.equal((await fail(v.renameFolder('F', 'G'))).key, 'err.vault.invalidItem');
  assert.equal((await fail(v.moveMany(v.items.map((i) => i.id), 'H'))).key, 'err.vault.invalidItem');
  assert.equal((await fail(v.deleteFolder('F'))).key, 'err.vault.invalidItem');
  assert.equal(state(), tampered, 'nothing was replaced, not even the first item that normalized fine');
  assert.equal(at(v.items, 0), originalFirst, 'same object');
  assert.deepEqual(await fs.readFile(path), fileBefore, 'nothing was written');
  v.key.fill(0);
});

test('unlock zeroes the derived key when building the Vault is refused (invalid item, unknown type, bad content)', async () => {
  const dir = await tmp();
  const cases: readonly (readonly [unknown, string])[] = [[{ items: [{ id: '1', name: 'x', password: 5 }] }, 'err.vault.invalidItem'], [{ items: [{ id: '1', name: 'x', type: 'passkey' }] }, 'err.vault.unknownItemType'], [{ items: 5 }, 'err.vault.invalidContent']];
  const ok = await vaultWith(dir, { items: [{ id: '1', name: 'fine' }] });
  const run = async (path: string) => {
    const zeroed: Buffer[] = [];
    const original = Buffer.prototype.fill;
    Buffer.prototype.fill = function (this: Buffer, value: string | Uint8Array | number, ...rest: [offset?: number, end?: number, encoding?: BufferEncoding]) {
      if (this.length === 32 && value === 0) zeroed.push(this);
      return original.call(this, value, ...rest);
    };
    try {
      const result: unknown = await Vault.unlock(PW, path, { migrate: false }).then((v) => v, (e: unknown) => e);
      return { result, zeroed };
    } finally {
      Buffer.prototype.fill = original;
    }
  };
  const good = await run(ok);
  assert.ok(good.result instanceof Vault);
  assert.equal(good.zeroed.length, 0, 'a successful open keeps the key alive');
  good.result.key.fill(0);
  for (const [content, key] of cases) {
    const { result, zeroed } = await run(await vaultWith(dir, content));
    assert.equal(thrownKey(result), key);
    assert.equal(zeroed.length, 1, `${key}: the 32-byte derived key was zeroed exactly once`);
    assert.ok(at(zeroed, 0).every((b) => b === 0));
  }
});
