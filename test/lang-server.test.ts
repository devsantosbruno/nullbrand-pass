import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import type { ServerOptions } from '../src/server.js';
import { header, jsonRecord, parseJson } from './support.js';

interface Ctx {
  call: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  base: string;
  home: string;
  dir: string;
}

async function withServer(opts: ServerOptions, fn: (ctx: Ctx) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'nb-langsrv-'));
  const home = join(dir, 'home');
  const srv = await startServer({ vaultPath: join(dir, 'vault.json'), home, ...opts });
  const base = `http://127.0.0.1:${srv.port}`;
  const auth = await fetch(`${base}/auth?t=${srv.token}`, { redirect: 'manual' });
  const cookie = header(auth, 'set-cookie').split(';')[0];
  const call: Ctx['call'] = (method, path, body, headers = {}) =>
    fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  try {
    await fn({ call, base, home, dir });
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('status reports the resolved language; starting does not create config.json', async () => {
  await withServer({ langFlag: 'pt' }, async ({ call, home }) => {
    const s = await jsonRecord(await call('GET', '/api/status'));
    assert.deepEqual([s['lang'], s['langSource']], ['pt', 'flag']);
    await assert.rejects(stat(join(home, 'config.json')), { code: 'ENOENT' });
  });
});

test('PUT /api/config saves the choice, keeps other fields, and needs session + Origin', async () => {
  await withServer({}, async ({ call, base, home }) => {
    const cfg = join(home, 'config.json');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(home, { recursive: true });
    await writeFile(cfg, JSON.stringify({ keep: 'me' }));

    assert.equal((await fetch(`${base}/api/config`, { method: 'PUT', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{"lang":"pt"}' })).status, 401, 'no cookie');
    assert.equal((await call('PUT', '/api/config', { lang: 'pt' }, { Origin: 'http://evil.example' })).status, 403, 'foreign origin');

    const bad = await call('PUT', '/api/config', { lang: 'fr' });
    assert.equal(bad.status, 400);
    assert.equal((await jsonRecord(bad))['key'], 'err.http.badLang');
    assert.deepEqual(parseJson(await readFile(cfg, 'utf8')), { keep: 'me' }, 'invalid value writes nothing');

    const ok = await call('PUT', '/api/config', { lang: 'pt' });
    assert.equal(ok.status, 200);
    assert.deepEqual(parseJson(await readFile(cfg, 'utf8')), { keep: 'me', lang: 'pt' });
    const s = await jsonRecord(await call('GET', '/api/status'));
    assert.deepEqual([s['lang'], s['langSource']], ['pt', 'config']);
    assert.equal((await jsonRecord(await call('GET', '/api/config')))['lang'], 'pt');
  });
});

test('/locales/<lang>.json is served to sessions only, and only for supported languages', async () => {
  await withServer({}, async ({ call, base }) => {
    assert.equal((await fetch(`${base}/locales/pt.json`)).status, 401);
    const res = await call('GET', '/locales/pt.json');
    assert.equal(res.status, 200);
    assert.match(header(res, 'content-type'), /application\/json/);
    assert.equal((await jsonRecord(res))['err.wrongPassword'], 'Senha mestra incorreta. O cofre continua bloqueado.');
    assert.equal((await call('GET', '/locales/fr.json')).status, 404);
    assert.equal((await call('GET', '/locales/../package.json')).status, 404);
  });
});

test('API errors carry an i18n key so the UI can translate them', async () => {
  await withServer({}, async ({ call }) => {
    assert.equal((await call('POST', '/api/setup', { password: 'strong-master-password' })).status, 200);
    await call('POST', '/api/lock');
    // lock drops the session; get a fresh server-side check through an endpoint that needs the vault
    const r = await call('GET', '/api/items');
    assert.ok([401, 423].includes(r.status));
    const body = await jsonRecord(r);
    const key = body['key'];
    assert.ok(typeof key === 'string' && key.startsWith('err.http.'), JSON.stringify(body));
    assert.ok(body['error'], 'English message is still there');
  });
});
