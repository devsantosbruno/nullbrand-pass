import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Vault, defaultHome, defaultVaultPath, hardenPermissions, backupVaultFile, vaultExists } from '../src/vault.js';

const skip = process.platform === 'win32' ? false : 'Windows only';
const PASSWORD = 'correct horse battery staple';

test('windows: the default vault path is absolute and inside the data directory', { skip }, () => {
  assert.equal(resolve(defaultVaultPath()), defaultVaultPath());
  assert.equal(defaultVaultPath(), join(defaultHome(), 'vault.json'));
});

test('windows: hardenPermissions leaves ACLs alone and reports nothing', { skip }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'nb-win-'));
  try {
    const path = join(base, '.nullbrand', 'vault.json');
    assert.deepEqual(await hardenPermissions(path), []);
    assert.deepEqual(await hardenPermissions(path, { detailed: true }), []);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('windows: create, save, reopen and back up a vault under a nested path', { skip }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'nb-win-'));
  try {
    const path = join(base, 'nested dir', '.nullbrand', 'vault.json');
    const vault = await Vault.create(PASSWORD, path);
    vault.key.fill(0);
    assert.ok(vaultExists(path));
    const backup = await backupVaultFile(path);
    assert.equal(await readFile(backup, 'utf8'), await readFile(path, 'utf8'));
    const leftovers = (await readdir(join(base, 'nested dir', '.nullbrand'))).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
    const reopened = await Vault.unlock(PASSWORD, path);
    reopened.key.fill(0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
