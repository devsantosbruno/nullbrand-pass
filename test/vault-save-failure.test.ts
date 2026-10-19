import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../src/vault.js';
import { at } from './support.js';

const PW = 'test-master-password';
const sha = async (path: string): Promise<string> => createHash('sha256').update(await fs.readFile(path)).digest('hex');

async function setup() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'nb-savefail-'));
  const path = join(dir, 'vault.json');
  const vault = await Vault.create(PW, path);
  await vault.add({ name: 'a', username: 'u', password: 'p', folder: 'work' });
  await vault.add({ name: 'b', username: 'u', password: 'p', folder: 'work' });
  await vault.add({ name: 'c', username: 'u', password: 'p' });
  await vault.addFolder('empty');
  return { dir, path, vault };
}

const BOOM = new Error('disk full');
const failSave = (vault: Vault): void => {
  vault.save = async () => {
    throw BOOM;
  };
};

type Op = readonly [string, (v: Vault) => Promise<unknown>];
const ops: readonly Op[] = [
  ['add', (v) => v.add({ name: 'new', username: 'u', password: 'p' })],
  ['update', (v) => v.update(at(v.items, 0).id, { name: 'renamed' })],
  ['remove', (v) => v.remove(at(v.items, 0).id)],
  ['removeMany', (v) => v.removeMany(v.items.map((i) => i.id))],
  ['addFolder', (v) => v.addFolder('fresh')],
  ['renameFolder', (v) => v.renameFolder('work', 'office')],
  ['renameFolder (merge into existing)', (v) => v.renameFolder('work', 'empty')],
  ['deleteFolder', (v) => v.deleteFolder('work')],
  ['deleteFolder (with items)', (v) => v.deleteFolder('work', { deleteItems: true })],
  ['moveMany', (v) => v.moveMany(v.items.map((i) => i.id), 'empty')],
  ['merge', (v) => v.merge([{ name: 'imp', username: 'u', password: 'p' }, { name: 'imp2', username: 'u', password: 'p' }])],
];

for (const [name, op] of ops) {
  test(`${name}: a failing save restores items and folders and rethrows the same error`, async () => {
    const { path, vault } = await setup();
    const items = structuredClone(vault.items);
    const folders = [...vault.folders];
    const itemsRef = vault.items;
    const foldersRef = vault.folders;
    const diskBefore = await sha(path);
    failSave(vault);
    await assert.rejects(op(vault), (e: unknown) => e === BOOM);
    assert.deepEqual(vault.items, items);
    assert.deepEqual(vault.folders, folders);
    assert.equal(vault.items, itemsRef, 'the very same array object is back');
    assert.equal(vault.folders, foldersRef);
    assert.equal(await sha(path), diskBefore);
    vault.key.fill(0);
  });
}

test('validation errors thrown before any change are untouched by the helper', async () => {
  const { vault } = await setup();
  const items = structuredClone(vault.items);
  await assert.rejects(vault.update('nope', {}), { key: 'err.vault.itemNotFound' });
  await assert.rejects(vault.remove('nope'), { key: 'err.vault.itemNotFound' });
  await assert.rejects(vault.renameFolder('missing', 'x'), { key: 'err.vault.folderNotFound' });
  await assert.rejects(vault.deleteFolder('missing'), { key: 'err.vault.folderNotFound' });
  assert.deepEqual(vault.items, items);
  vault.key.fill(0);
});

test('a real write failure (read-only directory): remove keeps the item and the file is unchanged', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('needs a non-root POSIX user');
    return;
  }
  const { dir, path, vault } = await setup();
  const id = at(vault.items, 0).id;
  const count = vault.items.length;
  const diskBefore = await sha(path);
  await fs.chmod(dir, 0o500);
  try {
    await assert.rejects(vault.remove(id), { code: 'EACCES' });
    assert.equal(vault.items.length, count);
    assert.ok(vault.get(id));
  } finally {
    await fs.chmod(dir, 0o700);
  }
  assert.equal(await sha(path), diskBefore);
  await vault.remove(id);
  const reopened = await Vault.unlock(PW, path, { migrate: false });
  assert.equal(reopened.items.length, count - 1);
  reopened.key.fill(0);
  vault.key.fill(0);
});

test('the success path still saves exactly what memory holds', async () => {
  const { path, vault } = await setup();
  await vault.add({ name: 'ok', username: 'u', password: 'p' });
  await vault.renameFolder('work', 'office');
  const reopened = await Vault.unlock(PW, path, { migrate: false });
  assert.deepEqual(reopened.items, vault.items);
  assert.deepEqual(reopened.folders, vault.folders);
  reopened.key.fill(0);
  vault.key.fill(0);
});
