import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, hardenPermissions } from '../src/vault.js';
import { WrongPasswordError, decryptJson, deriveKey } from '../src/crypto.js';
import type { KdfParams } from '../src/crypto.js';
import { toMasterPassword } from '../src/brands.js';
import { createClipboard, macBackend, ClipboardError } from '../src/clipboard.js';
import type { Backend } from '../src/clipboard.js';
import { startServer } from '../src/server.js';
import { header, jsonRecord, present, thrownKey, writeV2Vault } from './support.js';

const PW = 'test-master-password';
const tmp = () => mkdtemp(join(tmpdir(), 'nb-silent-'));

test('an authenticated payload with missing or malformed items/folders is refused, never opened as an empty vault', async () => {
  const dir = await tmp();
  try {
    const cases: readonly object[] = [{}, { folders: [] }, { items: null }, { items: 0 }, { items: '' }, { items: [], folders: 'x' }, { items: [], folders: {} }, { items: [], folders: null }];
    for (const [i, content] of cases.entries()) {
      const path = join(dir, `v${i}.json`);
      await writeV2Vault(path, PW, content);
      await assert.rejects(Vault.unlock(PW, path, { migrate: false }), (err) => thrownKey(err) === 'err.vault.invalidContent', JSON.stringify(content));
    }
    const ok = join(dir, 'ok.json');
    await writeV2Vault(ok, PW, { items: [] });
    const vault = await Vault.unlock(PW, ok, { migrate: false });
    assert.deepEqual([vault.items, vault.folders], [[], []], 'a vault without `folders` (old format) still opens');
    vault.key.fill(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('authentic but non-JSON content is "corrupted", not "wrong password"', async () => {
  const kdf: KdfParams = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32, salt: randomBytes(16).toString('base64') };
  const key = await deriveKey(toMasterPassword(PW), kdf);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update('this is not json', 'utf8'), cipher.final()]);
  const box = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  assert.throws(() => decryptJson(key, box), (err) => thrownKey(err) === 'err.vault.corrupted' && !(err instanceof WrongPasswordError));
  const wrong = await deriveKey(toMasterPassword('another-password'), kdf);
  assert.throws(() => decryptJson(wrong, box), WrongPasswordError);
  key.fill(0);
  wrong.fill(0);
});

test('macOS: a sensitive copy that falls back to pbcopy says it was not concealed', async () => {
  const calls: string[] = [];
  const b = macBackend(async (cmd) => {
    calls.push(cmd);
    if (cmd === 'osascript') throw new ClipboardError('failed', 'err.clipboard.run');
    return '';
  });
  const clip = createClipboard({ backend: b, ttlMs: 0 });
  assert.equal((await clip.copy('secret')).concealed, false);
  assert.deepEqual(calls, ['osascript', 'pbcopy']);
  assert.equal((await clip.copy('visible', { sensitive: false })).concealed, true, 'a non-sensitive copy has nothing to conceal');

  const good = createClipboard({ backend: macBackend(async () => ''), ttlMs: 0 });
  assert.equal((await good.copy('secret')).concealed, true);
  const plain: Backend = { name: 'plain', write: async () => '', read: async () => '', clear: async () => '' };
  assert.equal((await createClipboard({ backend: plain, ttlMs: 0 }).copy('secret')).concealed, true);
});

test('hardenPermissions: only a missing file is ignored; other stat failures surface', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('needs a non-root POSIX user');
    return;
  }
  const dir = await tmp();
  try {
    assert.deepEqual(await hardenPermissions(join(dir, 'missing', 'vault.json')), [], 'ENOENT is fine');
    const sub = join(dir, 'locked');
    await mkdir(sub, { mode: 0o700 });
    await writeFile(join(sub, 'vault.json'), '{}', { mode: 0o600 });
    await chmod(sub, 0o000);
    try {
      await assert.rejects(hardenPermissions(join(sub, 'vault.json')), (err) => err instanceof Error && 'code' in err && err.code === 'EACCES');
    } finally {
      await chmod(sub, 0o700);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function withServer(fn: (call: (method: string, path: string, body?: string) => Promise<Response>, dir: string) => Promise<void>, vaultFile = 'vault.json') {
  const dir = await tmp();
  const srv = await startServer({ vaultPath: join(dir, vaultFile), home: join(dir, 'home'), idleMinutes: 0 });
  try {
    const origin = `http://127.0.0.1:${srv.port}`;
    const auth = await fetch(`${origin}/auth?t=${srv.token}`, { redirect: 'manual' });
    const cookie = present(header(auth, 'set-cookie').split(';')[0], 'session cookie');
    await fn((method, path, body) => fetch(origin + path, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body }), dir);
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('a malformed percent-escape in the URL is a 400 with an i18n key', async () => {
  await withServer(async (call) => {
    for (const path of ['/api/items/%', '/api/items/%E0%A4%A']) {
      const r = await call('GET', path);
      assert.equal(r.status, 400, path);
      assert.equal((await jsonRecord(r))['key'], 'err.http.malformedUrl');
    }
  });
});

test('an unexpected failure is a logged 500 that does not leak the message', async (t) => {
  const logged: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void logged.push(args.map(String).join(' ')));
  await withServer(async (call, dir) => {
    await writeFile(join(dir, 'blocker'), 'x');
    const r = await call('POST', '/api/setup', JSON.stringify({ password: 'strong-master-password' }));
    const body = await jsonRecord(r);
    assert.equal(r.status, 500);
    assert.deepEqual([body['error'], body['key']], ['Unexpected error.', 'err.http.unexpected']);
  }, 'blocker/vault.json');
  assert.ok(logged.length > 0, 'the real cause is logged on the server side');
});
