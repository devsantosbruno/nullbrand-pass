// Spec 11: POST /api/shutdown never leaves an unhandled rejection, and a 405 is answered even when the request carries a body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { header, present } from './support.js';

async function withServer(onShutdown: () => void, fn: (origin: string, cookie: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'nb-s11-'));
  const srv = await startServer({ vaultPath: join(dir, 'vault.json'), home: join(dir, 'home'), idleMinutes: 0, onShutdown });
  try {
    const origin = `http://127.0.0.1:${srv.port}`;
    const auth = await fetch(`${origin}/auth?t=${srv.token}`, { redirect: 'manual' });
    await fn(origin, present(header(auth, 'set-cookie').split(';')[0], 'session cookie'));
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('shutdown: an onShutdown that throws is reported (exitCode 1), is not an unhandled rejection, and the server still closes', async () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  const errors: string[] = [];
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  console.error = (...args: unknown[]): void => {
    errors.push(args.join(' '));
  };
  let called = false;
  try {
    await withServer(
      () => {
        called = true;
        throw new Error('boom');
      },
      async (origin, cookie) => {
        const r = await fetch(`${origin}/api/shutdown`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(r.status, 200);
        for (let i = 0; i < 100 && !called; i++) await new Promise<void>((res) => setTimeout(() => res(), 20));
        assert.ok(called, 'onShutdown was called');
        await new Promise<void>((res) => setTimeout(() => res(), 50));
        assert.equal(process.exitCode, 1);
        assert.ok(errors.some((e) => e.includes('boom')), `error reported: ${errors.join('|')}`);
        await assert.rejects(fetch(`${origin}/api/status`, { headers: { Cookie: cookie } }), 'the server stopped listening');
      },
    );
    assert.deepEqual(rejections, []);
  } finally {
    console.error = originalError;
    process.exitCode = originalExitCode;
    process.off('unhandledRejection', onRejection);
  }
});

test('405: a PATCH with a 10 kB body always gets the 405 (never ECONNRESET), on / and on /auth', async () => {
  await withServer(() => {}, async (origin, cookie) => {
    const body = 'x'.repeat(10 * 1024);
    for (let i = 0; i < 20; i++) {
      for (const path of ['/', '/auth']) {
        const r = await fetch(origin + path, { method: 'PATCH', headers: { Cookie: cookie, Origin: origin }, body });
        assert.equal(r.status, 405, `${path} #${i}`);
        await r.text();
      }
    }
  });
});

// Spec 11 C: route × vault state → status (the UI keys on `key` and on 423, never on a 400 for these).
test('status codes: a locked vault is 423 on every folder route, a missing item is 404 on GET/PUT/DELETE, bad folder input stays 400', async () => {
  await withServer(() => {}, async (origin, cookie) => {
    const call = (method: string, path: string, body: object = {}) =>
      fetch(origin + path, { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const status = async (method: string, path: string, body?: object): Promise<number> => {
      const r = await call(method, path, body);
      await r.text();
      return r.status;
    };
    assert.equal((await call('POST', '/api/setup', { password: 'strong-master-password' })).status, 200);

    // unlocked
    assert.equal(await status('GET', '/api/items/nope'), 404);
    assert.equal(await status('PUT', '/api/items/nope', { name: 'x' }), 404);
    assert.equal(await status('DELETE', '/api/items/nope'), 404);
    assert.equal(await status('POST', '/api/folders', { name: '' }), 400);
    assert.equal(await status('PUT', '/api/folders', { from: 'ghost', to: 'x' }), 400);
    assert.equal(await status('POST', '/api/folders/delete', { name: 'ghost' }), 400);
    assert.equal(await status('POST', '/api/folders', { name: 'work' }), 200);

    // locked
    assert.equal(await status('POST', '/api/lock'), 200);
    assert.equal(await status('POST', '/api/folders', { name: 'work' }), 423);
    assert.equal(await status('PUT', '/api/folders', { from: 'work', to: 'job' }), 423);
    assert.equal(await status('POST', '/api/folders/delete', { name: 'work' }), 423);
    assert.equal(await status('GET', '/api/items/nope'), 423);
    assert.equal(await status('PUT', '/api/items/nope', { name: 'x' }), 423);
    assert.equal(await status('DELETE', '/api/items/nope'), 423);
  });
});
