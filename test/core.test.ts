import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, readBackupItems } from '../src/vault.js';
import { generatePassword, entropyBits } from '../src/generator.js';
import { parseBitwardenExport } from '../src/importers/bitwarden.js';
import { at, objectAt, parseJsonObject, present } from './support.js';

const tmp = async () => mkdtemp(join(tmpdir(), 'vp-test-'));

test('creates, saves and reopens the vault; wrong password fails', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  const v = await Vault.create('strong-master-password', path);
  await v.add({ name: 'GitHub', username: 'alice', password: 's3cr3t!', uris: ['github.com'] });

  const raw = await readFile(path, 'utf8');
  assert.ok(!raw.includes('s3cr3t!'), 'password must not appear in plain text');
  assert.ok(!raw.includes('GitHub'), 'item name is also encrypted');

  const again = await Vault.unlock('strong-master-password', path);
  assert.equal(again.items.length, 1);
  assert.equal(at(again.items, 0).password, 's3cr3t!');

  await assert.rejects(Vault.unlock('wrong-wrong', path), { code: 'WRONG_PASSWORD' });
  await rm(dir, { recursive: true });
});

test('tampering with the header (KDF) invalidates the vault', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await Vault.create('strong-master-password', path);
  const file = parseJsonObject(await readFile(path, 'utf8'));
  objectAt(file, 'payload')['data'] = Buffer.from('garbage').toString('base64');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, JSON.stringify(file));
  await assert.rejects(Vault.unlock('strong-master-password', path), { code: 'WRONG_PASSWORD' });
  await rm(dir, { recursive: true });
});

test('updates, removes, changes password and exports backup', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  const v = await Vault.create('strong-master-password', path);
  const a = await v.add({ name: 'A', password: '1' });
  await v.add({ name: 'B', password: '2' });
  await v.update(a.id, { password: 'fresh' });
  assert.equal(present(v.get(a.id)).password, 'fresh');
  await v.remove(a.id);
  assert.equal(v.items.length, 1);

  const backup = join(dir, 'backup.json');
  await v.exportBackup(backup);
  await v.changePassword('another-master-password');
  await assert.rejects(Vault.unlock('strong-master-password', path), { code: 'WRONG_PASSWORD' });
  assert.equal((await Vault.unlock('another-master-password', path)).items.length, 1);

  const restored = await readBackupItems(backup, 'strong-master-password');
  assert.equal(at(restored, 0).name, 'B');
  const r = await v.merge(restored);
  assert.deepEqual(r, { added: 0, skipped: 1 }, 'exact duplicate is skipped');
  await rm(dir, { recursive: true });
});

test('short master password is rejected', async () => {
  const dir = await tmp();
  await assert.rejects(Vault.create('curta', join(dir, 'v.json')));
  await rm(dir, { recursive: true });
});

test('generator respects options', () => {
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword({ length: 16, symbols: false, avoidAmbiguous: true });
    assert.equal(pw.length, 16);
    assert.match(pw, /^[a-zA-Z0-9]+$/);
    assert.doesNotMatch(pw, /[Il1O0o]/);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[0-9]/);
  }
  assert.equal(generatePassword({ length: 5, upper: false, lower: false, symbols: false }).length, 5);
  assert.throws(() => generatePassword({ upper: false, lower: false, digits: false, symbols: false }));
  assert.ok(entropyBits({ length: 20 }) > 120);
});

test('entropyBits describes the password that generatePassword builds', () => {
  assert.equal(entropyBits({ length: 2 }), entropyBits({ length: 4 }));
  assert.equal(entropyBits({ length: 500 }), entropyBits({ length: 128 }));
  for (const odd of ['abc', null, undefined, NaN, {}, []]) {
    const bits = entropyBits({ length: odd });
    assert.ok(Number.isFinite(bits), `finite for ${String(odd)}`);
    assert.equal(bits, entropyBits({}), `default length for ${String(odd)}`);
    assert.equal(generatePassword({ length: odd }).length, 20);
  }
  assert.equal(entropyBits({ length: '16' }), entropyBits({ length: 16 }));
  // Every valid length keeps the old formula: round(length * log2(alphabet size)).
  const sets: [Record<string, boolean>, number][] = [
    [{}, 26 + 26 + 10 + 25],
    [{ symbols: false }, 62],
    [{ upper: false, lower: false, symbols: false }, 10],
  ];
  for (const [opts, size] of sets) {
    for (let length = 4; length <= 128; length++) {
      assert.equal(entropyBits({ ...opts, length }), Math.round(length * Math.log2(size)), `length ${length} size ${size}`);
    }
  }
});

test('imports a Bitwarden export', () => {
  const exp = {
    encrypted: false,
    folders: [{ id: 'f1', name: 'Work' }],
    items: [
      { type: 1, name: 'Email', folderId: 'f1', favorite: true, notes: 'n', login: { username: 'u', password: 'p', totp: 'JBSWY3DP', uris: [{ uri: 'https://mail.com' }] }, fields: [{ name: 'PIN', value: '1234' }] },
      { type: 2, name: 'Note', notes: 'secret' },
      { type: 3, name: 'Card', card: { brand: 'Visa', number: '4111' } },
      { type: 1, name: 'Deleted', deletedDate: '2024-01-01', login: {} },
      { type: 5, name: 'SSH key' },
    ],
  };
  const { items, ignored } = parseBitwardenExport(JSON.stringify(exp));
  assert.equal(items.length, 3);
  assert.equal(ignored, 2);
  const first = at(items, 0);
  assert.equal(first.folder, 'Work');
  if (first.type !== 'login') assert.fail('the first imported item must be a login');
  assert.deepEqual(first.uris, ['https://mail.com']);
  assert.equal(first.totp, 'JBSWY3DP');
  assert.match(first.notes, /PIN: 1234/);
  assert.equal(at(items, 1).type, 'note');
  assert.match(at(items, 2).notes, /Card imported/);
  assert.throws(() => parseBitwardenExport(JSON.stringify({ encrypted: true, data: 'x' })), /encrypted/);
});

test('SSH key: generates, imports and normalizes the item', async () => {
  const { generateSshKey, inspectSshKey } = await import('../src/sshkey.js');
  const { normalizeItem } = await import('../src/vault.js');
  for (const algo of ['ed25519', 'rsa4096']) {
    const k = generateSshKey(algo);
    assert.match(k.privateKey, /^-----BEGIN OPENSSH PRIVATE KEY-----/);
    assert.match(k.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
    const back = inspectSshKey(k.privateKey);
    assert.equal(back.fingerprint, k.fingerprint);
    assert.equal(back.algo, algo);
  }
  const pub = inspectSshKey(generateSshKey('rsa4096').publicKey + ' me@macbook');
  assert.equal(pub.privateKey, '');
  assert.equal(pub.comment, 'me@macbook');
  assert.equal(pub.algo, 'rsa4096');
  assert.throws(() => inspectSshKey('garbage'), /Invalid/);
  assert.throws(() => inspectSshKey('-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----'), /Passphrase/);

  const item = normalizeItem({ type: 'ssh', name: 'Prod', sshHost: 'a b\nc.com', sshUser: 'root ', sshPort: '2a2', password: 'x' });
  assert.equal(item.sshHost, 'abc.com');
  assert.equal(item.sshUser, 'root');
  assert.equal(item.sshPort, '22');
  assert.equal(item.password, '');
  assert.equal(normalizeItem({ type: 'login', name: 'x', sshHost: 'h' }).sshHost, '');
});
