import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import type { RunningServer, ServerOptions } from '../src/server.js';
import { header } from './support.js';

// fetch doesn't allow overriding Host; node:http does.
interface RawResponse {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}
function raw(port: number, { method = 'GET', path = '/', headers = {} }: { method?: string; path?: string; headers?: Record<string, string> } = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(opts: ServerOptions, fn: (srv: RunningServer, origin: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'nb-auth-'));
  const srv = await startServer({ vaultPath: join(dir, 'vault.json'), ...opts });
  const origin = `http://127.0.0.1:${srv.port}`;
  try {
    await fn(srv, origin);
  } finally {
    await srv.close();
    await rm(dir, { recursive: true });
  }
}

const login = async (srv: RunningServer, origin: string) => {
  const res = await fetch(`${origin}/auth?t=${srv.token}`, { redirect: 'manual' });
  return { res, cookie: header(res, 'set-cookie').split(';')[0] ?? '' };
};

test('happy path: /auth exchanges the token for a session cookie and redirects to /', async () => {
  await withServer({}, async (srv, origin) => {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+\/auth\?t=[\w-]{43}$/); // 32 bytes in base64url
    const { res, cookie } = await login(srv, origin);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/');
    const setCookie = header(res, 'set-cookie');
    assert.match(setCookie, /^nullbrand_sid_\d+=[\w-]{43};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\//);
    assert.doesNotMatch(setCookie, /Expires|Max-Age/i);
    assert.ok(!setCookie.includes(srv.token), 'sid is separate from the token');

    const api = await fetch(`${origin}/api/status`, { headers: { Cookie: cookie } });
    assert.equal(api.status, 200);
    assert.equal(api.headers.get('cache-control'), 'no-store');
    assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(api.headers.get('referrer-policy'), 'no-referrer');
    assert.match(header(api, 'content-security-policy'), /default-src 'none'/);
    for (const [k] of api.headers) assert.ok(!k.startsWith('access-control-'), `no CORS: ${k}`);

    const post = await fetch(`${origin}/api/generate`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(post.status, 200);
  });
});

test('reused or wrong token → 403 without details', async () => {
  await withServer({}, async (srv, origin) => {
    const wrong = await fetch(`${origin}/auth?t=wrong`, { redirect: 'manual' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.headers.get('set-cookie'), null);
    assert.equal((await fetch(`${origin}/auth`, { redirect: 'manual' })).status, 403);

    // a wrong token doesn't consume the real one
    const first = await login(srv, origin);
    assert.equal(first.res.status, 303);

    const reuse = await fetch(`${origin}/auth?t=${srv.token}`, { redirect: 'manual' });
    assert.equal(reuse.status, 403);
    assert.equal(reuse.headers.get('set-cookie'), null);
    const body = await reuse.text();
    assert.ok(!/token|expir|used/i.test(body), `no details: ${body}`);
  });
});

test('bootstrap token expires', async () => {
  await withServer({ bootstrapTtlMs: 50 }, async (srv, origin) => {
    await new Promise<void>((r) => setTimeout(() => r(), 120));
    const res = await fetch(`${origin}/auth?t=${srv.token}`, { redirect: 'manual' });
    assert.equal(res.status, 403);
  });
});

test('invalid Host → 421 (DNS rebinding), including on /auth and the API', async () => {
  await withServer({}, async (srv, origin) => {
    for (const path of ['/', '/api/status']) {
      const r = await raw(srv.port, { path, headers: { Host: 'evil.example' } });
      assert.equal(r.status, 421);
    }
    const wrongPort = await raw(srv.port, { path: '/', headers: { Host: '127.0.0.1:1' } });
    assert.equal(wrongPort.status, 421);
    const auth = await raw(srv.port, { path: `/auth?t=${srv.token}`, headers: { Host: 'evil.example' } });
    assert.equal(auth.status, 421);
    assert.equal(auth.headers['set-cookie'], undefined);
    // the token was not consumed by the attempt with an invalid Host
    const { res, cookie } = await login(srv, origin);
    assert.equal(res.status, 303);
    const bad = await raw(srv.port, { path: '/api/status', headers: { Host: 'evil.example', Cookie: cookie } });
    assert.equal(bad.status, 421, 'a valid cookie does not save an invalid Host');
    const ok = await raw(srv.port, { path: '/api/status', headers: { Host: `localhost:${srv.port}`, Cookie: cookie } });
    assert.equal(ok.status, 200);
  });
});

test('POST without Origin or with an invalid Origin → 403', async () => {
  await withServer({}, async (srv, origin) => {
    const { cookie } = await login(srv, origin);
    const post = (headers: Record<string, string>) =>
      fetch(`${origin}/api/generate`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: '{}' });
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ Origin: 'http://evil.example' })).status, 403);
    assert.equal((await post({ Origin: 'null' })).status, 403);
    assert.equal((await post({ Origin: `https://127.0.0.1:${srv.port}` })).status, 403);
    assert.equal((await post({ Origin: origin })).status, 200);
    assert.equal((await post({ Origin: `http://localhost:${srv.port}` })).status, 200);
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const r = await fetch(`${origin}/api/items/x`, { method, headers: { Cookie: cookie } });
      assert.equal(r.status, 403, `${method} without Origin`);
    }
  });
});

test('missing or wrong cookie → 401', async () => {
  await withServer({}, async (srv, origin) => {
    const { cookie } = await login(srv, origin);
    const name = cookie.split('=')[0];
    assert.equal((await fetch(`${origin}/api/status`)).status, 401);
    assert.equal((await fetch(`${origin}/api/status`, { headers: { Cookie: `${name}=${'a'.repeat(43)}` } })).status, 401);
    assert.equal((await fetch(`${origin}/api/status`, { headers: { Cookie: `${name}=short` } })).status, 401);
    assert.equal((await fetch(`${origin}/api/status`, { headers: { Cookie: `outro=${cookie.split('=')[1]}` } })).status, 401);
    // the bootstrap token is not valid as an API credential
    assert.equal((await fetch(`${origin}/api/status`, { headers: { Cookie: `${name}=${srv.token}` } })).status, 401);
    assert.equal((await fetch(`${origin}/api/status`, { headers: { Cookie: cookie } })).status, 200);
  });
});

test('locking the vault keeps the session but requires the password again', async () => {
  await withServer({}, async (srv, origin) => {
    const { cookie } = await login(srv, origin);
    const h = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
    await fetch(`${origin}/api/setup`, { method: 'POST', headers: h, body: JSON.stringify({ password: 'strong-master-password' }) });
    assert.equal((await fetch(`${origin}/api/lock`, { method: 'POST', headers: h, body: '{}' })).status, 200);
    assert.equal((await fetch(`${origin}/api/status`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${origin}/api/items`, { headers: { Cookie: cookie } })).status, 423);
    // and the token cannot be reused to open another session
    assert.equal((await fetch(`${origin}/auth?t=${srv.token}`, { redirect: 'manual' })).status, 403);
  });
});

test('listens only on 127.0.0.1', async () => {
  await withServer({}, async (srv) => {
    // connects through the IPv4 loopback interface; the bind is explicit on 127.0.0.1
    const r = await raw(srv.port, { path: '/' });
    assert.equal(r.status, 401); // connects (bind ok), but without a session it gets nothing
  });
  assert.throws(() => startServer({ host: '0.0.0.0' }), { message: /only listens on 127\.0\.0\.1/ });
  assert.throws(() => startServer({ host: '::' }), { message: /only listens on 127\.0\.0\.1/ });
});
