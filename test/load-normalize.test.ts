import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Vault, readBackupItemsFromText } from '../src/vault.js';
import { deriveKey, encryptJson } from '../src/crypto.js';
import type { KdfParams } from '../src/crypto.js';
import { toMasterPassword } from '../src/brands.js';
import { at, thrownKey, thrownMessage, thrownParams } from './support.js';
import { fileURLToPath } from 'node:url';

const FIX = new URL('./fixtures/', import.meta.url);
const FIX_PW = 'fixture-master-password-ñ-123';
const PW = 'test-master-password';
const tmp = () => fs.mkdtemp(join(tmpdir(), 'nb-load-'));
const listDir = async (dir: string) => (await fs.readdir(dir)).sort();

async function writeLegacy(path: string, items: readonly unknown[]) {
  const kdf: KdfParams = { name: 'scrypt', N: 2 ** 14, r: 8, p: 1, keyLen: 32, salt: randomBytes(16).toString('base64') };
  const header = { format: 'nullbrand-vault', version: 1, kdf };
  const key = await deriveKey(toMasterPassword(PW), kdf);
  const payload = encryptJson(key, { items }, `${header.format}:${header.version}:${JSON.stringify(kdf)}`);
  await fs.writeFile(path, JSON.stringify({ ...header, updatedAt: new Date().toISOString(), payload }, null, 2) + '\n');
  key.fill(0);
}

for (const name of ['legacy-vault.json', 'legacy-backup.json']) {
  test(`fixture ${name} opens and its already-normalized items come out deep-equal to the originals`, async () => {
    const file = new URL(name, FIX);
    const original = await readBackupItemsFromText(await fs.readFile(file, 'utf8'), FIX_PW);
    assert.deepEqual(original.map((i) => i.type).sort(), ['card', 'identity', 'login', 'note', 'ssh']);
    const v = await Vault.unlock(FIX_PW, fileURLToPath(file), { migrate: false });
    assert.deepEqual(v.items, original);
    v.key.fill(0);
  });
}

test('minimal v1 vault opens and the item gains the defaults without touching id/name/password', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await writeLegacy(path, [{ id: '1', name: 'Old', password: 'abc' }]);
  const v = await Vault.unlock(PW, path, { migrate: false });
  assert.deepEqual(v.items, [{
    id: '1', type: 'login', name: 'Old', username: '', password: 'abc', uris: [], totp: '',
    cardholder: '', cardNumber: '', cardExpiry: '', cardCvv: '',
    fullName: '', email: '', phone: '', birthDate: '', rg: '', cpf: '', pis: '', cnpj: '', cnh: '', passport: '',
    address: '', city: '', state: '', zip: '', country: '',
    sshAlgo: '', sshTitle: '', sshPublicKey: '', sshFingerprint: '', sshPrivateKey: '', sshHost: '', sshUser: '', sshPort: '',
    notes: '', folder: '', favorite: false, createdAt: '', updatedAt: '',
  }]);
});

test('load keeps id/createdAt/updatedAt and unknown extra fields, and writes nothing', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  const raw = { id: 'x', type: 'note', name: 'N', notes: 'hi', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2021-02-02T00:00:00.000Z', futureField: { a: 1 } };
  await writeLegacy(path, [raw]);
  const before = await fs.readFile(path);
  const v = await Vault.unlock(PW, path, { migrate: false });
  const item = at(v.items, 0);
  const fields: Readonly<Record<string, unknown>> = item;
  assert.equal(item.id, 'x');
  assert.equal(item.createdAt, raw.createdAt);
  assert.equal(item.updatedAt, raw.updatedAt);
  assert.deepEqual(fields['futureField'], { a: 1 });
  assert.equal(item.username, '');
  assert.deepEqual(await fs.readFile(path), before);
  assert.deepEqual(await listDir(dir), ['vault.json']);
});

test('Vault.find works on a legacy item without uris/username', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await writeLegacy(path, [{ id: '1', name: 'Old', password: 'abc' }]);
  const v = await Vault.unlock(PW, path, { migrate: false });
  assert.equal(v.find('old').length, 1);
  assert.equal(v.find('nothing-matches-this').length, 0);
});

test('an item with an unknown type rejects the open with an explicit error and does not modify the vault', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await writeLegacy(path, [{ id: '1', name: 'Ok' }, { id: '2', name: 'From the future', type: 'passkey' }]);
  const before = await fs.readFile(path);
  const files = await listDir(dir);
  await assert.rejects(Vault.unlock(PW, path), (e) => {
    const params = thrownParams(e);
    assert.equal(thrownKey(e), 'err.vault.unknownItemType');
    assert.equal(params['type'], 'passkey');
    assert.equal(params['id'], '2');
    assert.equal(params['name'], 'From the future');
    assert.equal(params['position'], 2);
    assert.match(thrownMessage(e), /id: 2, name: From the future.*passkey.*newer version/);
    return true;
  });
  assert.deepEqual(await fs.readFile(path), before);
  assert.deepEqual(await listDir(dir), files);
});

test('malformed items (wrong field type, field of another type filled, no id) are rejected, not coerced, and the error names the item and field', async () => {
  const dir = await tmp();
  const cases: readonly (readonly [unknown, { id: string; name: string; field: string }])[] = [
    [{ id: '1', name: 'x', password: 123 }, { id: '1', name: 'x', field: 'password' }],
    [{ id: '7', name: 'Leftover', type: 'note', password: 'leftover' }, { id: '7', name: 'Leftover', field: 'password' }],
    [{ id: '3', name: 'x', uris: 'https://a' }, { id: '3', name: 'x', field: 'uris' }],
    [{ name: 'no id' }, { id: '(none)', name: 'no id', field: 'id' }],
    ['not an object', { id: '(none)', name: '(none)', field: 'item' }],
  ];
  for (const [bad, want] of cases) {
    const path = join(dir, `v-${randomBytes(3).toString('hex')}.json`);
    const ok = { id: 'ok', name: 'fine' };
    await writeLegacy(path, [ok, bad]);
    await assert.rejects(Vault.unlock(PW, path, { migrate: false }), (e) => {
      const params = thrownParams(e);
      assert.equal(thrownKey(e), 'err.vault.invalidItem', JSON.stringify(bad));
      assert.equal(params['position'], 2);
      assert.equal(params['id'], want.id);
      assert.equal(params['name'], want.name);
      assert.equal(params['field'], want.field);
      assert.ok(thrownMessage(e).includes(`#2 (id: ${want.id}, name: ${want.name})`) && thrownMessage(e).includes(`"${want.field}"`), thrownMessage(e));
      return true;
    }, JSON.stringify(bad));
  }
});
