// Security: AES-GCM authentication tags must be exactly 16 bytes. Node 22.14 accepts a truncated tag (4 or 8 bytes with the right
// prefix) unless `authTagLength` is given, which would cut the integrity check down to 32 bits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, readBackupItemsFromText, readVaultFile } from '../src/vault.js';
import { WrongPasswordError, decryptJson, deriveKey, encryptJson } from '../src/crypto.js';
import type { EncryptedBox, KdfParams } from '../src/crypto.js';
import { toMasterPassword } from '../src/brands.js';
import { at, objectAt, parseJsonObject, thrownKey, writeV2Vault } from './support.js';

const PW = 'test-master-password';
const FIX = new URL('./fixtures/', import.meta.url);
const FIX_PW = 'fixture-master-password-ñ-123';
const BAD_LENGTHS = [0, 4, 8, 12, 15, 17];

// Writes a v2 vault holding one item and returns its text plus a copy whose payload tag is `tagBytes` long: the first bytes of the
// genuine tag (so a truncated tag has the CORRECT prefix, the exact case Node accepts without authTagLength), padded with zeros if longer.
async function vaultTextWithTag(dir: string, tagBytes: number): Promise<string> {
  const path = join(dir, `vault-${tagBytes}.json`);
  await writeV2Vault(path, PW, { items: [{ id: '1', name: 'one' }], folders: [] });
  const file = parseJsonObject(await readFile(path, 'utf8'));
  const payload = objectAt(file, 'payload');
  const real = Buffer.from(String(payload['tag']), 'base64');
  assert.equal(real.length, 16);
  payload['tag'] = Buffer.concat([real, Buffer.alloc(32)]).subarray(0, tagBytes).toString('base64');
  return JSON.stringify(file) + '\n';
}

test('the fixtures carry 16-byte tags and still open unchanged', async () => {
  for (const name of ['legacy-vault.json', 'legacy-backup.json']) {
    const file = parseJsonObject(readFileSync(new URL(name, FIX), 'utf8'));
    assert.equal(Buffer.from(String(objectAt(file, 'payload')['tag']), 'base64').length, 16, name);
  }
  const vault = await Vault.unlock(FIX_PW, new URL('legacy-vault.json', FIX).pathname, { migrate: false });
  assert.ok(vault.items.length > 0);
  const items = await readBackupItemsFromText(readFileSync(new URL('legacy-backup.json', FIX), 'utf8'), FIX_PW);
  assert.ok(items.length > 0);
});

test('encryptJson → decryptJson round trip, and the tag is 16 bytes', async () => {
  const kdf = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32, salt: Buffer.alloc(16, 7).toString('base64') } as const;
  const key = await deriveKey(toMasterPassword(PW), kdf);
  const box = encryptJson(key, { a: 1 }, 'aad');
  assert.equal(Buffer.from(box.tag, 'base64').length, 16);
  assert.deepEqual(decryptJson(key, box, 'aad'), { a: 1 });
  key.fill(0);
});

test('decryptJson refuses a tag that is not 16 bytes, before decrypting', async () => {
  const kdf = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32, salt: Buffer.alloc(16, 7).toString('base64') } as const;
  const key = await deriveKey(toMasterPassword(PW), kdf);
  const box = encryptJson(key, { a: 1 });
  const real = Buffer.from(box.tag, 'base64');
  for (const n of BAD_LENGTHS) {
    const cut: EncryptedBox = { ...box, tag: Buffer.concat([real, Buffer.alloc(32)]).subarray(0, n).toString('base64') };
    assert.throws(() => decryptJson(key, cut), (err: unknown) => thrownKey(err) === 'err.vault.corrupted' && !(err instanceof WrongPasswordError), `${n} bytes`);
  }
  key.fill(0);
});

test('a vault file with a tag that is not 16 bytes is refused when read (before scrypt), in both paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nb-tag-'));
  for (const n of BAD_LENGTHS) {
    const text = await vaultTextWithTag(dir, n);
    const path = join(dir, `bad-${n}.json`);
    await writeFile(path, text);
    await assert.rejects(readVaultFile(path), (err: unknown) => thrownKey(err) === 'err.vault.corrupted', `file ${n} bytes`);
    await assert.rejects(Vault.unlock(PW, path, { migrate: false }), (err: unknown) => thrownKey(err) === 'err.vault.corrupted', `unlock ${n} bytes`);
    // Backup path. An EMPTY password would reject with err.emptyPassword if deriveKey ran first, so this also proves the check
    // happens before the key derivation.
    await assert.rejects(readBackupItemsFromText(text, ''), (err: unknown) => thrownKey(err) === 'err.vault.corrupted', `backup ${n} bytes`);
    await assert.rejects(readBackupItemsFromText(text, PW), (err: unknown) => thrownKey(err) === 'err.vault.corrupted', `backup+pw ${n} bytes`);
  }
});

test('a 16-byte tag that was tampered with is still reported as wrong password / not authentic', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nb-tag-'));
  const file = parseJsonObject(await vaultTextWithTag(dir, 16));
  const payload = objectAt(file, 'payload');
  const tag = Buffer.from(String(payload['tag']), 'base64');
  tag[0] = (at([...tag], 0) ^ 0xff) & 0xff;
  payload['tag'] = tag.toString('base64');
  const path = join(dir, 'tampered.json');
  await writeFile(path, JSON.stringify(file));
  await assert.rejects(Vault.unlock(PW, path, { migrate: false }), (err: unknown) => err instanceof WrongPasswordError);
  await assert.rejects(readBackupItemsFromText(JSON.stringify(file), PW), (err: unknown) => err instanceof WrongPasswordError);
});

test('decryptJson passes authTagLength to createDecipheriv (second layer, checked in the compiled source)', () => {
  const src = readFileSync(new URL('../src/crypto.js', import.meta.url), 'utf8');
  assert.match(src, /createDecipheriv\('aes-256-gcm',[^;]*\{\s*authTagLength:\s*GCM_TAG_LEN\s*\}\)/);
});

test('a failed decryption (wrong key, tampered data) leaves the next good decryption unaffected', async () => {
  const salt = Buffer.alloc(16, 7).toString('base64');
  const kdf: KdfParams = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32, salt };
  const good = await deriveKey(toMasterPassword(PW), kdf);
  const bad = await deriveKey(toMasterPassword('another-master-password'), kdf);
  const value = { items: [{ id: '1', name: 'one' }] };
  const box = encryptJson(good, value, 'aad');
  const tampered: EncryptedBox = { ...box, data: Buffer.from(box.data, 'base64').fill(0, 0, 1).toString('base64') };
  for (let i = 0; i < 3; i++) {
    assert.throws(() => decryptJson(bad, box, 'aad'), WrongPasswordError);
    assert.throws(() => decryptJson(good, tampered, 'aad'), WrongPasswordError);
    assert.throws(() => decryptJson(good, box, 'other-aad'), WrongPasswordError);
    assert.deepEqual(decryptJson(good, box, 'aad'), value);
  }
});
