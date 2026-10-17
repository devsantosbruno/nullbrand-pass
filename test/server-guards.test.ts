// Stage 5b: server, CLI entry and bin behaviours that the typed code makes explicit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunningServer } from '../src/server.js';
import { startServer } from '../src/server.js';
import { header, jsonRecord, present } from './support.js';

interface Ctx {
  srv: RunningServer;
  origin: string;
  cookie: string;
  call: (method: string, path: string, body?: string, extra?: Record<string, string>) => Promise<Response>;
}

const BIN = new URL('../bin/nullbrand.js', import.meta.url).pathname;

async function withServer(fn: (ctx: Ctx) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'nb-srv5b-'));
  const srv = await startServer({ vaultPath: join(dir, 'vault.json'), home: join(dir, 'home'), idleMinutes: 0 });
  try {
    const origin = `http://127.0.0.1:${srv.port}`;
    const auth = await fetch(`${origin}/auth?t=${srv.token}`, { redirect: 'manual' });
    const cookie = present(header(auth, 'set-cookie').split(';')[0], 'session cookie');
    await fn({ srv, origin, cookie, call: (method, path, body, extra = {}) => fetch(origin + path, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...extra }, body }) });
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('a JSON `null` body is "Invalid JSON" for the routes that read fields, and harmless for the ones that do not', async () => {
  await withServer(async ({ call }) => {
    const targets: readonly (readonly [string, string])[] = [['POST', '/api/setup'], ['POST', '/api/unlock'], ['PUT', '/api/config'], ['POST', '/api/generate-nothing']];
    for (const [method, path] of targets) {
      const r = await call(method, path, 'null');
      if (path === '/api/generate-nothing') { assert.equal(r.status, 404); continue; }
      const body = await jsonRecord(r);
      if (path === '/api/unlock') { assert.equal(r.status, 404); continue; } // no vault yet: refused before the body is read
      assert.equal(r.status, 400, path);
      assert.equal(body['key'], 'err.http.invalidJson', path);
    }
    assert.equal((await call('POST', '/api/lock', 'null')).status, 200, 'a route that reads no field never looked at the body');
    assert.equal((await call('POST', '/api/generate', 'null')).status, 200, 'generate takes any JSON value');
  });
});

test('POST /api/generate keeps accepting a string length ("16") and any JSON value as options', async () => {
  await withServer(async ({ call }) => {
    const r = await jsonRecord(await call('POST', '/api/generate', JSON.stringify({ length: '16' })));
    const password = r['password'];
    const bits = r['bits'];
    assert.ok(typeof password === 'string');
    assert.equal(password.length, 16);
    assert.equal(typeof bits, 'number');
    assert.ok(typeof bits === 'number' && bits > 80);
    for (const body of ['5', '"abc"', '[1,2]', 'true']) assert.equal((await call('POST', '/api/generate', body)).status, 200, body);
  });
});

test('a client that disconnects in the middle of the body does not take the server down (no unhandled rejection)', async () => {
  const problems: unknown[] = [];
  const onRejection = (e: unknown) => void problems.push(e);
  process.on('unhandledRejection', onRejection);
  try {
    await withServer(async ({ srv, origin, cookie, call }) => {
      await call('POST', '/api/setup', JSON.stringify({ password: 'correct horse battery' }));
      for (let i = 0; i < 3; i++) {
        await new Promise<void>((resolve) => {
          const s = connect(srv.port, '127.0.0.1', () => {
            s.write(`POST /api/items HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"name":"half`);
            setTimeout(() => { s.destroy(); setTimeout(() => resolve(), 60); }, 40);
          });
          s.on('error', () => {});
        });
      }
      const items: unknown = await (await call('GET', '/api/items')).json();
      assert.deepEqual(items, [], 'nothing half-saved');
      assert.equal((await call('GET', '/api/status')).status, 200, 'still serving');
    });
    await new Promise<void>((r) => setTimeout(() => r(), 50));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  assert.deepEqual(problems, []);
});

test('body limit: exactly 10 MiB is accepted, one byte more is 413', async () => {
  await withServer(async ({ call }) => {
    const pad = (n: number) => '{"pad":"' + 'a'.repeat(n - 10) + '"}';
    assert.equal((await call('POST', '/api/lock', pad(10 * 1024 * 1024))).status, 200);
    const big = await call('POST', '/api/lock', pad(10 * 1024 * 1024 + 1));
    assert.equal(big.status, 413);
    assert.equal((await jsonRecord(big))['key'], 'err.http.fileTooLarge');
  });
});

test('bin: refuses Node older than 22.14 with the same message as before, and runs on 22.14+', () => {
  const withVersion = (v: string, args: string[] = []) => spawnSync(process.execPath, ['--input-type=module', '-e', `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(v)} }); process.argv = [process.argv[0], ${JSON.stringify(BIN)}, ...${JSON.stringify(args)}]; await import(${JSON.stringify('file://' + BIN)});`], { encoding: 'utf8' });
  for (const old of ['22.13.9', '20.19.0', '21.7.3', '18.0.0', '10.24.1']) {
    const r = withVersion(old);
    assert.equal(r.status, 1, old);
    assert.equal(r.stderr.trim(), `nullbrand requires Node.js 22.14 or newer (you have ${old}).`);
  }
  for (const ok of ['22.14.0', '22.14.1', '22.99.0', '23.0.0', '24.1.0']) {
    const r = withVersion(ok, ['--version']);
    assert.equal(r.status, 0, `${ok}: ${r.stderr}`);
    assert.match(r.stdout, /^\d+\.\d+\.\d+/);
  }
});

test('bin is executable and starts with the node shebang', () => {
  const out = execFileSync(BIN, ['--version'], { encoding: 'utf8' });
  assert.match(out, /^\d+\.\d+\.\d+/);
});
