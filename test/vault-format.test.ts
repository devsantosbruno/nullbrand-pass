import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Vault, hardenPermissions } from '../src/vault.js';
import { deriveKey, encryptJson } from '../src/crypto.js';
import type { KdfParams } from '../src/crypto.js';
import { toMasterPassword } from '../src/brands.js';
import { at, objectAt, parseJsonObject, present } from './support.js';
import type { JsonObject } from './support.js';

const POSIX = process.platform !== 'win32';
const tmp = () => fs.mkdtemp(join(tmpdir(), 'nb-fmt-'));
const mode = async (p: string) => (await fs.stat(p)).mode & 0o777;
const PW = 'test-master-password';

async function writeLegacy(path: string, { N = 2 ** 14, items = [{ id: '1', name: 'Old', password: 'abc' }] }: { N?: number; items?: readonly unknown[] } = {}) {
  const kdf: KdfParams = { name: 'scrypt', N, r: 8, p: 1, keyLen: 32, salt: randomBytes(16).toString('base64') };
  const header = { format: 'nullbrand-vault', version: 1, kdf };
  const key = await deriveKey(toMasterPassword(PW), kdf);
  const payload = encryptJson(key, { items }, `${header.format}:${header.version}:${JSON.stringify(kdf)}`);
  await fs.writeFile(path, JSON.stringify({ ...header, updatedAt: new Date().toISOString(), payload }, null, 2) + '\n');
  key.fill(0);
}
const listDir = async (dir: string) => (await fs.readdir(dir)).sort();

test('new vault: v2 header, strong KDF, salt/IV/tag and 0700/0600 permissions', async () => {
  const dir = join(await tmp(), 'data');
  const path = join(dir, 'vault.json');
  await Vault.create(PW, path);
  const f = parseJsonObject(await fs.readFile(path, 'utf8'));
  const kdf = objectAt(f, 'kdf');
  const payload = objectAt(f, 'payload');
  assert.equal(f['format'], 'nullbrand-vault');
  assert.equal(f['version'], 2);
  assert.deepEqual({ ...kdf, salt: undefined }, { name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32, salt: undefined });
  assert.ok(Buffer.from(String(kdf['salt']), 'base64').length >= 16);
  assert.equal(Buffer.from(String(payload['iv']), 'base64').length, 12);
  assert.equal(Buffer.from(String(payload['tag']), 'base64').length, 16);
  if (POSIX) {
    assert.equal(await mode(dir), 0o700);
    assert.equal(await mode(path), 0o600);
  }
  assert.deepEqual(await listDir(dir), ['vault.json'], 'no leftover temporary files');
  assert.equal((await Vault.unlock(PW, path)).migration, undefined);
});

for (const N of [2 ** 14, 2 ** 17]) {
  test(`v1 vault (N=2^${Math.log2(N)}) opens, makes a 0600 backup and migrates to v2`, async () => {
    const dir = await tmp();
    const path = join(dir, 'vault.json');
    await writeLegacy(path, { N });
    const original = await fs.readFile(path);

    const v = await Vault.unlock(PW, path);
    assert.equal(at(v.items, 0).password, 'abc');
    assert.equal(v.migrationError, undefined);
    const migration = present(v.migration, 'migration');
    assert.equal(migration.from.version, 1);
    assert.equal(v.header.version, 2);
    assert.ok(v.header.kdf.N >= 2 ** 17);

    const baks = (await listDir(dir)).filter((n) => n.startsWith('vault.json.bak-'));
    assert.equal(baks.length, 1);
    const bak = at(baks, 0);
    assert.deepEqual(await fs.readFile(join(dir, bak)), original);
    assert.equal(migration.backup, join(dir, bak));
    if (POSIX) assert.equal(await mode(join(dir, bak)), 0o600);

    const f = parseJsonObject(await fs.readFile(path, 'utf8'));
    assert.equal(f['version'], 2);
    assert.equal(f['format'], 'nullbrand-vault');
    const again = await Vault.unlock(PW, path);
    assert.equal(at(again.items, 0).name, 'Old');
    assert.equal(again.migration, undefined);
    assert.equal((await listDir(dir)).filter((n) => n.includes('.bak-')).length, 1);
    await assert.rejects(Vault.unlock('wrong-wrong', path), { code: 'WRONG_PASSWORD' });
  });
}

test('migrate:false opens the old vault without rewriting anything', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await writeLegacy(path);
  const before = await fs.readFile(path);
  const v = await Vault.unlock(PW, path, { migrate: false });
  assert.equal(v.items.length, 1);
  assert.deepEqual(await fs.readFile(path), before);
  assert.deepEqual(await listDir(dir), ['vault.json']);
});

type SwappableFs = { -readonly [K in 'rename' | 'open']: (typeof fs)[K] };
const swappable: SwappableFs = fs;
async function withFsFailure<K extends keyof SwappableFs, T>(method: K, wrap: (orig: SwappableFs[K]) => SwappableFs[K], fn: () => Promise<T>): Promise<T> {
  const orig = swappable[method];
  swappable[method] = wrap(orig);
  try {
    return await fn();
  } finally {
    swappable[method] = orig;
  }
}
const failRename = () => async () => { throw new Error('disk full (simulated)'); };
const failMidWrite = (open: typeof fs.open) => async (...args: Parameters<typeof fs.open>) => {
  const fh = await open(...args);
  const writeFile = fh.writeFile.bind(fh);
  fh.writeFile = async (data) => { await writeFile(data.slice(0, 20)); throw new Error('failure in the middle of the write (simulated)'); };
  return fh;
};

const writeFailures: readonly { name: string; run: <T>(fn: () => Promise<T>) => Promise<T> }[] = [
  { name: 'rename fails', run: (fn) => withFsFailure('rename', failRename, fn) },
  { name: 'write breaks midway', run: (fn) => withFsFailure('open', failMidWrite, fn) },
];
for (const { name, run } of writeFailures) {
  test(`interrupted write (${name}): the original survives and no temporary file is left`, async () => {
    const dir = await tmp();
    const path = join(dir, 'vault.json');
    const v = await Vault.create(PW, path);
    await v.add({ name: 'Important', password: 'p' });
    const before = await fs.readFile(path);

    await run(async () => {
      await assert.rejects(v.add({ name: 'New', password: 'q' }), /simulated/);
      await assert.rejects(v.changePassword('another-master-password'), /simulated/);
    });
    assert.deepEqual(await fs.readFile(path), before);
    assert.deepEqual(await listDir(dir), ['vault.json']);
    assert.equal(at((await Vault.unlock(PW, path)).items, 0).name, 'Important');
    assert.deepEqual(v.items.map((i) => i.name), ['Important']);
    await v.add({ name: 'Later', password: 'r' });
    const names = (await Vault.unlock(PW, path)).items.map((i) => i.name);
    assert.deepEqual(names.sort(), ['Important', 'Later']);
  });
}

test('migration that fails on write: unlock works and the old file stays intact', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await writeLegacy(path);
  const before = await fs.readFile(path);
  const v = await withFsFailure('rename', failRename, () => Vault.unlock(PW, path));
  assert.equal(at(v.items, 0).password, 'abc');
  assert.match(present(v.migrationError, 'migrationError'), /simulated/);
  assert.equal(v.header.version, 1);
  assert.deepEqual(await fs.readFile(path), before);
  assert.ok((await listDir(dir)).every((n) => n === 'vault.json' || n.includes('.bak-')), 'no .tmp');
  assert.equal((await Vault.unlock(PW, path)).header.version, 2);
});

test('a tampered header fails authentication', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await Vault.create(PW, path);
  const base = parseJsonObject(await fs.readFile(path, 'utf8'));
  const mutations: Record<string, (f: JsonObject) => void> = {
    'smaller N': (f) => { objectAt(f, 'kdf')['N'] = 2 ** 16; },
    'different r': (f) => { objectAt(f, 'kdf')['r'] = 9; },
    'different p': (f) => { objectAt(f, 'kdf')['p'] = 2; },
    'swapped salt': (f) => { objectAt(f, 'kdf')['salt'] = randomBytes(16).toString('base64'); },
    'downgraded version': (f) => { f['version'] = 1; },
    'swapped tag': (f) => { objectAt(f, 'payload')['tag'] = randomBytes(16).toString('base64'); },
    'swapped iv': (f) => { objectAt(f, 'payload')['iv'] = randomBytes(12).toString('base64'); },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const f = structuredClone(base);
    mutate(f);
    await fs.writeFile(path, JSON.stringify(f));
    await assert.rejects(Vault.unlock(PW, path), { code: 'WRONG_PASSWORD' }, name);
  }
});

test('a header with an absurd or unknown KDF is rejected before deriving', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await Vault.create(PW, path);
  const base = parseJsonObject(await fs.readFile(path, 'utf8'));
  const badKdfs: readonly (readonly [Record<string, unknown>, RegExp])[] = [

    [{ N: 2 ** 30 }, /KDF: N/],
    [{ N: 1000 }, /KDF: N/],
    [{ r: 1000 }, /KDF: r/],
    [{ p: 0 }, /KDF: p/],
    [{ name: 'argon2id' }, /argon2id is not supported yet/],
    [{ name: 'md5' }, /unknown/],
    [{ salt: 'AAAA' }, /KDF: salt/],
  ];
  for (const [kdf, re] of badKdfs) {
    await fs.writeFile(path, JSON.stringify({ ...base, kdf: { ...objectAt(base, 'kdf'), ...kdf } }));
    const t = Date.now();
    await assert.rejects(Vault.unlock(PW, path), re);
    assert.ok(Date.now() - t < 100, 'immediate rejection, without spending memory');
  }
});

test('hardenPermissions fixes the data directory, vault and backups that are too open', { skip: !POSIX }, async () => {
  const home = join(await tmp(), '.nullbrand');
  await fs.mkdir(home, { mode: 0o755 });
  const path = join(home, 'vault.json');
  await fs.writeFile(path, '{}', { mode: 0o644 });
  await fs.writeFile(`${path}.bak-1`, '{}', { mode: 0o644 });
  await fs.chmod(home, 0o755);
  await fs.chmod(path, 0o644);
  await fs.chmod(`${path}.bak-1`, 0o644);

  const msgs = await hardenPermissions(path);
  assert.equal(msgs.length, 3);
  assert.equal(await mode(home), 0o700);
  assert.equal(await mode(path), 0o600);
  assert.equal(await mode(`${path}.bak-1`), 0o600);
  assert.deepEqual(await hardenPermissions(path), [], 'already correct: silence');
});

test('hardenPermissions leaves alone a directory that is not nullbrand\'s (--vault ./vault.json)', { skip: !POSIX }, async () => {
  const dir = await tmp();
  await fs.chmod(dir, 0o755);
  const path = join(dir, 'vault.json');
  await fs.writeFile(path, '{}', { mode: 0o644 });
  await fs.chmod(path, 0o644);
  const msgs = await hardenPermissions(path);
  assert.equal(msgs.length, 1);
  assert.equal(await mode(dir), 0o755);
  assert.equal(await mode(path), 0o600);
});
