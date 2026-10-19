// Spec 04 — the plain writers: what they keep, what they say they lose, and the guard around writing the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPlain, planImport } from '../src/formats/index.js';
import { Vault, normalizeItem, verifyMasterPassword, writePrivateFile } from '../src/vault.js';
import type { VaultItem } from '../src/shared/vault-types.js';
import { at, thrownKey } from './support.js';

const PW = 'test-master-password';
const tmp = () => fs.mkdtemp(join(tmpdir(), 'nb-export-'));
const IS_WIN = process.platform === 'win32';

const ITEMS: VaultItem[] = [
  normalizeItem({ type: 'login', name: 'Mail', folder: 'Work', favorite: true, username: 'me', password: 's3cret', totp: 'JBSWY3DP', uris: ['https://a.example', 'https://b.example'], notes: 'hello', createdAt: '2024-01-02T03:04:05.000Z' }),
  normalizeItem({ type: 'note', name: 'Memo', notes: 'remember\nthis' }),
  normalizeItem({ type: 'card', name: 'Visa', folder: 'Work', cardholder: 'J DOE', cardNumber: '4111111111111111', cardExpiry: '03/2030', cardCvv: '123', notes: 'card notes' }),
  normalizeItem({ type: 'identity', name: 'Me', fullName: 'Jane Q Doe', email: 'j@example.com', phone: '555', cpf: '123', cnh: '456', passport: 'X1', address: 'Street 1', city: 'City', state: 'ST', zip: '01000', country: 'BR', rg: 'RG-9', pis: 'PIS-9', cnpj: 'CNPJ-9', birthDate: '1990-01-01' }),
  normalizeItem({ type: 'ssh', name: 'Deploy', sshAlgo: 'ed25519', sshPublicKey: 'ssh-ed25519 AAAA', sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----', sshHost: 'example.com', sshUser: 'deploy' }),
];
const FOLDERS = ['Work'];

// The same fields in the same place, for what the layout can hold.
const same = (a: VaultItem, b: VaultItem, fields: readonly string[]): void => {
  const x: Readonly<Record<string, unknown>> = a;
  const y: Readonly<Record<string, unknown>> = b;
  for (const field of fields) assert.deepEqual(y[field], x[field], `${a.name}.${field}`);
};

test('json: login, note, card and identity survive export -> import', () => {
  const { text } = exportPlain(ITEMS, FOLDERS);
  const back = planImport(text).items.map((item) => normalizeItem({ ...item }));
  assert.equal(back.length, ITEMS.length);
  same(at(ITEMS, 0), at(back, 0), ['type', 'name', 'folder', 'favorite', 'username', 'password', 'totp', 'uris', 'notes', 'createdAt']);
  same(at(ITEMS, 1), at(back, 1), ['type', 'name', 'folder', 'notes']);
  same(at(ITEMS, 2), at(back, 2), ['type', 'name', 'folder', 'cardholder', 'cardNumber', 'cardExpiry', 'cardCvv', 'notes']);
  same(at(ITEMS, 3), at(back, 3), ['type', 'name', 'fullName', 'email', 'phone', 'cpf', 'cnh', 'passport', 'address', 'city', 'state', 'zip', 'country']);
});

test('json: what the layout has no field for travels in the notes as key: value', () => {
  const { text, warnings } = exportPlain(ITEMS, FOLDERS);
  const identity = at(planImport(text).items, 3);
  for (const line of ['birthDate: 1990-01-01', 'rg: RG-9', 'pis: PIS-9', 'cnpj: CNPJ-9']) assert.match(identity.notes, new RegExp(line));
  assert.ok(warnings.some((w) => w.key === 'export.warn.movedToNotes'));
});

test('json: an SSH key becomes a note, private key included, and the export says so for that item', () => {
  const { text, warnings } = exportPlain(ITEMS, FOLDERS);
  const ssh = at(planImport(text).items, 4);
  assert.equal(ssh.type, 'note');
  assert.match(ssh.notes, /sshPrivateKey: -----BEGIN OPENSSH PRIVATE KEY-----/);
  assert.deepEqual(warnings.filter((w) => w.key === 'export.warn.sshAsNote').map((w) => w.params['name']), ['Deploy']);
});

test('json: folders are listed once and items point at them; the file says it is not encrypted', () => {
  const document: unknown = JSON.parse(exportPlain(ITEMS, FOLDERS).text);
  assert.ok(document !== null && typeof document === 'object' && 'encrypted' in document && 'folders' in document);
  assert.equal(document.encrypted, false);
  assert.deepEqual(document.folders, [{ id: 'folder-1', name: 'Work' }]);
});

test('export: the file name carries the date', () => {
  const day = new Date('2025-03-04T10:00:00Z');
  assert.equal(exportPlain([], [], day).filename, 'nullbrand-export-2025-03-04.json');
});

test('guard: the master password is checked against the vault file; a wrong one is refused', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  (await Vault.create(PW, path)).key.fill(0);
  await verifyMasterPassword(PW, path);
  await assert.rejects(verifyMasterPassword('not the password', path), (e) => thrownKey(e) === 'err.wrongPassword');
});

test('guard: the plain file is written private to the owner, replaces an existing one, and leaves no temp file behind', async () => {
  const dir = await tmp();
  const dest = join(dir, 'export.json');
  await fs.writeFile(dest, 'old', { mode: 0o644 });
  await writePrivateFile(dest, 'new content');
  assert.equal(await fs.readFile(dest, 'utf8'), 'new content');
  if (!IS_WIN) assert.equal((await fs.stat(dest)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(dir), ['export.json']);
});

test('merge: an imported file lands in the vault, folders and all, and importing it again adds nothing', async () => {
  const dir = await tmp();
  const vault = await Vault.create(PW, join(dir, 'vault.json'));
  const plan = planImport(exportPlain(ITEMS, FOLDERS).text, { folder: 'Imported' });
  const first = await vault.merge(plan.items);
  assert.equal(first.added, ITEMS.length);
  assert.ok(vault.listFolders().includes('Imported/Work'));
  const second = await vault.merge(plan.items);
  assert.deepEqual([second.added, second.skipped], [0, ITEMS.length]);
});
