import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { createClipboard } from '../src/clipboard.js';
import type { Backend } from '../src/clipboard.js';
import { fileURLToPath } from 'node:url';
import { at, header, jsonRecord, jsonRecords, present, walkFiles } from './support.js';

test('local API: session, Host/Origin, full flow', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vp-srv-'));
  let srv = await startServer({ vaultPath: join(dir, 'vault.json') });
  let base = `http://127.0.0.1:${srv.port}`;
  const auth = await fetch(`${base}/auth?t=${srv.token}`, { redirect: 'manual' });
  let cookie = header(auth, 'set-cookie').split(';')[0];
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method,
      headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });

  try {
    assert.equal((await fetch(base + '/')).status, 401, 'static files also require a session');
    const page = await call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(header(page, 'content-security-policy'), /default-src 'none'/);

    assert.equal((await fetch(base + '/api/status')).status, 401);
    assert.equal((await call('GET', '/api/status', null, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await call('GET', '/../package.json')).status, 404);

    let s = await jsonRecord(await call('GET', '/api/status'));
    assert.equal(s['exists'], false);

    assert.equal((await call('POST', '/api/setup', { password: 'strong-master-password' })).status, 200);
    assert.equal((await call('GET', '/api/items')).status, 200);

    const created = await jsonRecord(await call('POST', '/api/items', { name: 'Bank', username: 'me', password: 'bank-password-123' }));
    const list = await jsonRecords(await call('GET', '/api/items'));
    assert.equal(list.length, 1);
    assert.equal(at(list, 0)['password'], undefined, 'list does not expose passwords');
    const full = await jsonRecord(await call('GET', `/api/items/${created['id']}`));
    assert.equal(full['password'], 'bank-password-123');

    const gen = await jsonRecord(await call('POST', '/api/generate', { length: 32 }));
    const genPassword = gen['password'];
    assert.ok(typeof genPassword === 'string');
    assert.equal(genPassword.length, 32);

    const nested = { encrypted: false, items: [{ type: 1, name: 'Imported', login: { username: 'a', password: 'b' } }] };
    const imp = await jsonRecord(await call('POST', '/api/import', { text: JSON.stringify(nested) }));
    assert.equal(imp['added'], 1);

    const bulkIds = (await jsonRecords(await call('GET', '/api/items'))).map((i) => i['id']);
    assert.equal((await call('POST', '/api/items/bulk', { action: 'move', ids: bulkIds, folder: 'Office' })).status, 200);
    assert.ok((await jsonRecords(await call('GET', '/api/items'))).every((i) => i['folder'] === 'Office'));
    assert.equal((await call('POST', '/api/items/bulk', { action: 'move', ids: [] })).status, 400);
    const temp = await jsonRecord(await call('POST', '/api/items', { name: 'Temp', password: 'x' }));
    assert.equal((await call('POST', '/api/items/bulk', { action: 'delete', ids: [temp['id']] })).status, 200);
    assert.equal((await jsonRecords(await call('GET', '/api/items'))).length, bulkIds.length);

    const folderJson = async (method: string, path: string, body?: unknown) => {
      const answer: unknown = await (await call(method, path, body)).json();
      return answer;
    };
    assert.deepEqual((await folderJson('POST', '/api/folders', { name: 'Unused' })), { name: 'Unused' });
    assert.deepEqual(await folderJson('GET', '/api/folders'), ['Office', 'Unused']);
    assert.equal((await call('POST', '/api/folders', { name: '   ' })).status, 400);
    assert.deepEqual(await folderJson('PUT', '/api/folders', { from: 'Unused', to: 'Personal' }), { name: 'Personal' });
    assert.equal((await call('PUT', '/api/folders', { from: 'Nothing', to: 'X' })).status, 400);
    assert.deepEqual(await folderJson('PUT', '/api/folders', { from: 'Office', to: 'personal' }), { name: 'Personal' });
    assert.deepEqual(await folderJson('GET', '/api/folders'), ['Personal']);
    assert.ok((await jsonRecords(await call('GET', '/api/items'))).every((i) => i['folder'] === 'Personal'));
    assert.deepEqual(await folderJson('POST', '/api/folders/delete', { name: 'Personal' }), { ok: true, count: bulkIds.length });
    assert.deepEqual(await folderJson('GET', '/api/folders'), []);
    assert.equal((await jsonRecords(await call('GET', '/api/items'))).length, bulkIds.length, 'items kept');
    await call('POST', '/api/items/bulk', { action: 'move', ids: [bulkIds[0]], folder: 'Trash' });
    assert.equal((await jsonRecord(await call('POST', '/api/folders/delete', { name: 'Trash', deleteItems: true })))['count'], 1);
    assert.equal((await jsonRecords(await call('GET', '/api/items'))).length, bulkIds.length - 1);
    await call('POST', '/api/items', { name: 'Restored', password: 'x-restored-123' });

    const backup = await call('GET', '/api/export/backup');
    assert.match(header(backup, 'content-disposition'), /attachment/);
    const backupText = await backup.text();
    assert.ok(!backupText.includes('bank-password-123'));

    await call('POST', '/api/lock');
    assert.equal((await call('GET', '/api/items')).status, 423);
    await srv.close();
    srv = await startServer({ vaultPath: join(dir, 'vault.json') });
    base = `http://127.0.0.1:${srv.port}`;
    cookie = header(await fetch(`${base}/auth?t=${srv.token}`, { redirect: 'manual' }), 'set-cookie').split(';')[0];
    assert.equal((await call('GET', '/api/items')).status, 423);
    assert.equal((await call('POST', '/api/unlock', { password: 'wrong-wrong' })).status, 401);
    assert.equal((await call('POST', '/api/unlock', { password: 'strong-master-password' })).status, 200);

    const restored: unknown = await (await call('POST', '/api/import/backup', { text: backupText, password: 'strong-master-password' })).json();
    assert.deepEqual(restored, { added: 0, skipped: 2 });

    s = await jsonRecord(await call('GET', '/api/status'));
    assert.equal(s['count'], 2);

    assert.equal((await call('POST', '/api/destroy', { password: 'wrong-wrong' })).status, 401);
    assert.equal((await call('POST', '/api/destroy', { password: 'strong-master-password' })).status, 200);
    assert.equal((await call('GET', '/api/status')).status, 401, 'deleting also ends the session');
  } finally {
    await srv.close();
    await rm(dir, { recursive: true });
  }
});

test('refuses to listen outside localhost', () => {
  assert.throws(() => startServer({ host: '0.0.0.0' }), { message: /only listens on 127\.0\.0\.1/ });
});

test('clipboard API: requires an unlocked vault, copies via the server and clears on lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vp-clip-'));
  const calls: (['write', boolean | undefined] | ['clear'])[] = [];
  let content = '';
  const backend: Backend = {
    name: 'fake',
    write: async (t, o) => { content = t; calls.push(['write', present(o, 'write options').sensitive]); return ''; },
    read: async () => content,
    clear: async () => { content = ''; calls.push(['clear']); return ''; },
  };
  const clipboard = createClipboard({ backend, ttlMs: 30_000 });
  const srv = await startServer({ vaultPath: join(dir, 'vault.json'), clipboard, clipboardTtlMs: 30_000 });
  const base = `http://127.0.0.1:${srv.port}`;
  const auth = await fetch(`${base}/auth?t=${srv.token}`, { redirect: 'manual' });
  const cookie = header(auth, 'set-cookie').split(';')[0];
  const call = (path: string, body?: unknown) => fetch(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  try {
    await call('/api/setup', { password: 'strong-master-password' });
    assert.equal((await fetch(base + '/api/clipboard/copy', { method: 'POST', headers: { Origin: base }, body: '{}' })).status, 401);
    assert.equal((await call('/api/clipboard/copy', { text: '' })).status, 400);

    const r = await call('/api/clipboard/copy', { text: 'secret', sensitive: true });
    const copied: unknown = await r.json();
    assert.deepEqual(copied, { ok: true, seconds: 30 });
    assert.equal(content, 'secret');

    const plain: unknown = await (await call('/api/clipboard/copy', { text: 'user', sensitive: false })).json();
    assert.deepEqual(plain, { ok: true, seconds: 0 });
    assert.equal(clipboard.pending, false);

    await call('/api/clipboard/copy', { text: 'secret2' });
    await call('/api/lock');
    assert.equal(content, '', 'locking clears the clipboard');

    await call('/api/unlock', { password: 'strong-master-password' });
    await call('/api/clipboard/copy', { text: 'secret3' });
    content = 'something else';
    await srv.close();
    assert.equal(content, 'something else', 'quitting does not erase what is not the password');
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('static: every module the build ships (subfolders too) is served as JavaScript with the security headers, behind the session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vp-static-'));
  const srv = await startServer({ vaultPath: join(dir, 'vault.json') });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const cookie = header(await fetch(`${base}/auth?t=${srv.token}`, { redirect: 'manual' }), 'set-cookie').split(';')[0];
    const modules = (await walkFiles(fileURLToPath(new URL('../public/', import.meta.url)))).filter((f) => f.endsWith('.js'));
    assert.ok(modules.includes('app.js'));
    for (const file of modules) {
      assert.equal((await fetch(`${base}/${file}`)).status, 401, `${file} without a session`);
      const res = await fetch(`${base}/${file}`, { headers: { Cookie: cookie, Origin: base } });
      assert.equal(res.status, 200, file);
      assert.match(header(res, 'content-type'), /^text\/javascript/, file);
      assert.match(header(res, 'content-security-policy'), /script-src 'self'; style-src 'self'/, file);
      assert.equal(header(res, 'x-content-type-options'), 'nosniff', file);
      assert.equal(header(res, 'cache-control'), 'no-cache', file);
    }
    const html = await (await fetch(`${base}/`, { headers: { Cookie: cookie, Origin: base } })).text();
    assert.deepEqual([...html.matchAll(/<script\b[^>]*>/g)].map((m) => at(m, 0)), ['<script type="module" src="/app.js">']);
    assert.doesNotMatch(html, /<style\b|\sstyle="|\son[a-z]+="/i, 'no inline style or inline event handler in index.html');
  } finally {
    await srv.close();
    await rm(dir, { recursive: true });
  }
});
