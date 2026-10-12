import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

test('API local: token, Host/Origin, fluxo completo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vp-srv-'));
  const srv = await startServer({ vaultPath: join(dir, 'vault.json') });
  const base = `http://127.0.0.1:${srv.port}`;
  const call = (method, path, body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: { 'X-Voltrama-Token': srv.token, 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });

  try {
    // Página estática com CSP
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);

    // Sem token → 401
    assert.equal((await fetch(base + '/api/status')).status, 401);
    // Origem estranha → 403
    assert.equal((await call('GET', '/api/status', null, { Origin: 'http://evil.example' })).status, 403);
    // Path traversal → 404
    assert.equal((await fetch(base + '/../package.json')).status, 404);

    let s = await (await call('GET', '/api/status')).json();
    assert.equal(s.exists, false);

    assert.equal((await call('POST', '/api/setup', { password: 'senha-mestra-forte' })).status, 200);
    assert.equal((await call('GET', '/api/items')).status, 200);

    const created = await (await call('POST', '/api/items', { name: 'Banco', username: 'eu', password: 'senha-do-banco-123' })).json();
    const list = await (await call('GET', '/api/items')).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].password, undefined, 'lista não expõe senhas');
    const full = await (await call('GET', `/api/items/${created.id}`)).json();
    assert.equal(full.password, 'senha-do-banco-123');

    const gen = await (await call('POST', '/api/generate', { length: 32 })).json();
    assert.equal(gen.password.length, 32);

    const bw = { encrypted: false, items: [{ type: 1, name: 'Importado', login: { username: 'a', password: 'b' } }] };
    const imp = await (await call('POST', '/api/import/bitwarden', { text: JSON.stringify(bw) })).json();
    assert.equal(imp.added, 1);

    const backup = await call('GET', '/api/export/backup');
    assert.match(backup.headers.get('content-disposition'), /attachment/);
    const backupText = await backup.text();
    assert.ok(!backupText.includes('senha-do-banco-123'));

    await call('POST', '/api/lock');
    assert.equal((await call('GET', '/api/items')).status, 423);
    assert.equal((await call('POST', '/api/unlock', { password: 'errada-errada' })).status, 401);
    assert.equal((await call('POST', '/api/unlock', { password: 'senha-mestra-forte' })).status, 200);

    const restored = await (await call('POST', '/api/import/backup', { text: backupText, password: 'senha-mestra-forte' })).json();
    assert.deepEqual(restored, { added: 0, skipped: 2 });

    s = await (await call('GET', '/api/status')).json();
    assert.equal(s.count, 2);
  } finally {
    await srv.close();
    await rm(dir, { recursive: true });
  }
});

test('recusa escutar fora do localhost', () => {
  assert.throws(() => startServer({ host: '0.0.0.0' }));
});
