import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import type { RunningServer } from '../src/server.js';
import { createClipboard } from '../src/clipboard.js';
import type { Backend } from '../src/clipboard.js';
import { readBackupItemsFromText } from '../src/vault.js';
import {
  guardExportResponse,
  guardImportAnswer,
  guardImportResponse,
  isImportPreviewResponse,
  guardClipboardCopyResponse,
  guardConfigResponse,
  guardCountResponse,
  guardFolderDeleteResponse,
  guardFolderList,
  guardFolderNameResponse,
  guardGenerateResponse,
  guardMergeResponse,
  guardOkResponse,
  guardPublicItems,
  guardShutdownAck,
  guardSshKeyResponse,
  guardStatusResponse,
  guardVaultItem,
  isApiErrorResponse,
} from '../src/shared/api-guards.js';
import type { Guard } from '../src/shared/api-guards.js';
import { isObjectLike } from '../src/shared/guards.js';
import { header, parseJson, writeV2Vault } from './support.js';

const FIX = new URL('./fixtures/', import.meta.url);
const FIX_PW = 'fixture-master-password-ñ-123';
const OWN_PW = 'strong-master-password';
const CHANGED_PW = 'another-strong-password';

const SERVER_ROUTES: readonly string[] = [...readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').matchAll(/^\s+'((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^']*)'/gm)].map((m) => m[1] ?? '');
const covered = new Set<string>();

interface Reply {
  status: number;
  text: string;
  json: unknown;
  contentDisposition: string | null;
}
interface CallOptions {
  id?: string;
  body?: unknown;
  noCookie?: boolean;
  origin?: string;
}

class Api {
  constructor(
    private readonly base: string,
    private readonly cookie: string,
  ) {}

  async call(route: string, { id, body, noCookie = false, origin }: CallOptions = {}): Promise<Reply> {
    const match = /^([A-Z]+) (\S+)$/.exec(route);
    if (match === null) assert.fail(`bad route key: ${route}`);
    const method = match[1] ?? '';
    const path = (match[2] ?? '').replace(':id', encodeURIComponent(id ?? 'missing'));
    covered.add(route);
    const headers: Record<string, string> = { Origin: origin ?? this.base, 'Content-Type': 'application/json' };
    if (!noCookie) headers['Cookie'] = this.cookie;
    const res = await fetch(this.base + path, { method, headers, ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    let json: unknown;
    try {
      json = parseJson(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json, contentDisposition: res.headers.get('content-disposition') };
  }

  async ok<T>(route: string, guard: Guard<T>, options: CallOptions = {}): Promise<T> {
    const reply = await this.call(route, options);
    assert.equal(reply.status, 200, `${route}: status ${reply.status}`);
    const verdict = guard(reply.json);
    if (!verdict.ok) assert.fail(`${route}: the guard refused a legitimate answer of the server (${verdict.reason})`);
    return verdict.value;
  }

  async error(route: string, status: number, options: CallOptions = {}): Promise<void> {
    const reply = await this.call(route, options);
    assert.equal(reply.status, status, `${route}: expected ${status}, got ${reply.status}`);
    assert.ok(isApiErrorResponse(reply.json), `${route} (${status}): the error answer does not pass isApiErrorResponse`);
  }
}

function fakeClipboard() {
  let content = '';
  const backend: Backend = {
    name: 'fake',
    write: async (text) => { content = text; return ''; },
    read: async () => content,
    clear: async () => { content = ''; return ''; },
  };
  return { clipboard: createClipboard({ backend, ttlMs: 30_000 }), content: () => content };
}

async function withServer(
  prepare: (dir: string, vaultPath: string) => Promise<void>,
  fn: (api: Api, srv: RunningServer, dir: string, vaultPath: string) => Promise<void>,
  onShutdown: () => void = () => {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'nb-contract-'));
  const vaultPath = join(dir, 'data', 'vault.json');
  await mkdir(join(dir, 'data'), { recursive: true });
  await prepare(dir, vaultPath);
  const { clipboard } = fakeClipboard();
  const srv = await startServer({ vaultPath, home: join(dir, 'home'), idleMinutes: 0, clipboard, clipboardTtlMs: 30_000, onShutdown });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const auth = await fetch(`${base}/auth?t=${srv.token}`, { redirect: 'manual' });
    const cookie = header(auth, 'set-cookie').split(';')[0] ?? '';
    await fn(new Api(base, cookie), srv, dir, vaultPath);
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const EXTRA_FIELDS_ITEMS: readonly object[] = [
  { id: 'x1', name: 'Legacy login', username: 'u', password: 'pw-legacy', uris: ['https://a.example'], createdAt: '', updatedAt: '', futureField: { a: 1 }, other: 'SENTINEL' },
  { id: 'x2', type: 'note', name: 'Extra note', notes: 'text', createdAt: '', updatedAt: '', fancy: [1, 2, 3] },
  { id: 'x3', type: 'card', name: 'Extra card', cardholder: 'ME', cardNumber: '4111111111111111', createdAt: '', updatedAt: '', brand: 'visa' },
  { id: 'x4', type: 'identity', name: 'Extra identity', fullName: 'My Name', createdAt: '', updatedAt: '', mother: 'x' },
  { id: 'x5', type: 'ssh', name: 'Extra ssh', sshAlgo: 'ed25519', sshPrivateKey: 'PRIVATE', sshHost: 'h', createdAt: '', updatedAt: '', tags: ['a'] },
];

const NEW_ITEMS: readonly object[] = [
  { type: 'login', name: 'C login', username: 'u', password: 'pw', uris: ['https://c.example'], totp: 'JBSWY3DP', favorite: true },
  { type: 'note', name: 'C note', notes: 'text' },
  { type: 'card', name: 'C card', cardholder: 'ME', cardNumber: '4111111111111111', cardExpiry: '12/30', cardCvv: '123' },
  { type: 'identity', name: 'C identity', fullName: 'My Name', email: 'a@b.c' },
  { type: 'ssh', name: 'C ssh', sshAlgo: 'ed25519', sshPublicKey: 'ssh-ed25519 AAAA', sshPrivateKey: 'PRIV', sshHost: 'h', sshUser: 'u', sshPort: '22' },
];

async function walk(api: Api, { password, existing, thorough, expectedItems }: { password: string; existing: boolean; thorough: boolean; expectedItems: number }): Promise<void> {
  for (const route of SERVER_ROUTES) await api.error(route, 401, { noCookie: true, id: 'x', body: {} });
  await api.error('POST /api/generate', 403, { origin: 'http://evil.example', body: {} });
  await api.error('GET /api/nothing-here', 404);

  const status = await api.ok('GET /api/status', guardStatusResponse);
  assert.deepEqual([status.exists, status.unlocked, status.count], [existing, false, null]);
  await api.ok('GET /api/config', guardConfigResponse);
  assert.equal((await api.ok('PUT /api/config', guardConfigResponse, { body: { lang: 'en' } })).lang, 'en');
  await api.ok('POST /api/generate', guardGenerateResponse, { body: { length: 24 } });
  const generated = await api.ok('POST /api/ssh/generate', guardSshKeyResponse, { body: { algo: 'ed25519' } });
  const inspected = await api.ok('POST /api/ssh/inspect', guardSshKeyResponse, { body: { privateKey: generated.privateKey } });
  assert.equal(inspected.fingerprint, generated.fingerprint);
  assert.equal((await api.ok('POST /api/ssh/inspect', guardSshKeyResponse, { body: { privateKey: generated.publicKey + ' me@host' } })).privateKey, '');
  if (thorough) await api.ok('POST /api/ssh/generate', guardSshKeyResponse, { body: { algo: 'rsa4096' } });
  await api.error('POST /api/ssh/generate', 400, { body: { algo: 'dsa' } });
  await api.error('POST /api/ssh/inspect', 400, { body: { privateKey: 'garbage' } });
  for (const route of [
    'GET /api/items', 'GET /api/items/:id', 'POST /api/items', 'PUT /api/items/:id', 'DELETE /api/items/:id', 'POST /api/items/bulk', 'GET /api/folders',
    'POST /api/clipboard/copy', 'POST /api/import', 'POST /api/import/backup', 'GET /api/export/backup', 'POST /api/export',
    'POST /api/password',
  ]) {
    await api.error(route, 423, { id: 'x', body: {} });
  }
  for (const route of ['POST /api/folders', 'PUT /api/folders', 'POST /api/folders/delete']) {
    const reply = await api.call(route, { body: {} });
    assert.equal(reply.status, 423, `${route} while locked`);
    assert.ok(isApiErrorResponse(reply.json), `${route}: the error answer does not pass isApiErrorResponse`);
    assert.ok(isObjectLike(reply.json) && reply.json['key'] === 'err.http.locked', `${route}: key err.http.locked`);
  }
  await api.error('PUT /api/config', 400, { body: { lang: 'fr' } });
  await api.error('PUT /api/config', 400, { body: null });
  if (existing) {
    await api.error('POST /api/setup', 409, { body: { password: OWN_PW } });
    if (thorough) {
      await api.error('POST /api/unlock', 401, { body: { password: 'wrong-wrong-wrong' } });
      await api.error('POST /api/destroy', 401, { body: { password: 'wrong-wrong-wrong' } });
    }
    await api.ok('POST /api/unlock', guardOkResponse, { body: { password } });
  } else {
    await api.error('POST /api/unlock', 404, { body: { password: OWN_PW } });
    await api.error('POST /api/destroy', 404, { body: { password: OWN_PW } });
    await api.ok('POST /api/setup', guardOkResponse, { body: { password } });
  }

  const unlocked = await api.ok('GET /api/status', guardStatusResponse);
  assert.deepEqual([unlocked.exists, unlocked.unlocked, unlocked.count], [true, true, expectedItems]);
  const listed = await api.ok('GET /api/items', guardPublicItems);
  assert.equal(listed.length, expectedItems);
  for (const entry of listed) {
    const full = await api.ok('GET /api/items/:id', guardVaultItem, { id: entry.id });
    assert.equal(full.id, entry.id);
    assert.equal(full.type, entry.type);
    assert.equal(full.name, entry.name);
  }
  await api.error('GET /api/items/:id', 404, { id: 'does-not-exist' });
  await api.error('PUT /api/items/:id', 404, { id: 'does-not-exist', body: { name: 'x' } });
  await api.error('DELETE /api/items/:id', 404, { id: 'does-not-exist' });

  const created: string[] = [];
  for (const input of NEW_ITEMS) {
    const item = await api.ok('POST /api/items', guardVaultItem, { body: input });
    created.push(item.id);
    const renamed = await api.ok('PUT /api/items/:id', guardVaultItem, { id: item.id, body: { ...input, name: `${item.name} (edited)`, notes: 'edited' } });
    assert.equal(renamed.id, item.id);
  }
  const afterCreate = await api.ok('GET /api/items', guardPublicItems);
  assert.equal(afterCreate.length, expectedItems + NEW_ITEMS.length);
  assert.equal(new Set(afterCreate.map((i) => i.type)).size, 5, 'all five types are in the list');
  const [first = '', second = '', third = '', fourth = '', fifth = ''] = created;

  assert.equal((await api.ok('POST /api/folders', guardFolderNameResponse, { body: { name: 'Contract' } })).name, 'Contract');
  await api.error('POST /api/folders', 400, { body: { name: '   ' } });
  assert.ok((await api.ok('GET /api/folders', guardFolderList)).includes('Contract'));
  assert.equal((await api.ok('POST /api/items/bulk', guardCountResponse, { body: { action: 'move', ids: [first, second], folder: 'Contract' } })).count, 2);
  await api.error('POST /api/items/bulk', 400, { body: { action: 'move', ids: [] } });
  await api.error('POST /api/items/bulk', 400, { body: { action: 'explode', ids: [first] } });
  assert.equal((await api.ok('PUT /api/folders', guardFolderNameResponse, { body: { from: 'Contract', to: 'Renamed' } })).name, 'Renamed');
  await api.error('PUT /api/folders', 400, { body: { from: 'Nothing', to: 'X' } });
  assert.equal((await api.ok('POST /api/folders/delete', guardFolderDeleteResponse, { body: { name: 'Renamed' } })).count, 2);
  await api.ok('POST /api/folders', guardFolderNameResponse, { body: { name: 'Trash' } });
  await api.ok('POST /api/items/bulk', guardCountResponse, { body: { action: 'move', ids: [third], folder: 'Trash' } });
  assert.equal((await api.ok('POST /api/folders/delete', guardFolderDeleteResponse, { body: { name: 'Trash', deleteItems: true } })).count, 1);
  assert.equal((await api.ok('POST /api/items/bulk', guardCountResponse, { body: { action: 'delete', ids: [fourth] } })).count, 1);
  await api.ok('DELETE /api/items/:id', guardOkResponse, { id: fifth });
  await api.ok('GET /api/folders', guardFolderList);

  assert.equal((await api.ok('POST /api/clipboard/copy', guardClipboardCopyResponse, { body: { text: 'secret', sensitive: true } })).seconds, 30);
  assert.equal((await api.ok('POST /api/clipboard/copy', guardClipboardCopyResponse, { body: { text: 'user', sensitive: false } })).seconds, 0);
  await api.error('POST /api/clipboard/copy', 400, { body: { text: '' } });

  await api.ok('POST /api/generate', guardGenerateResponse, { body: { length: 8 } });
  await api.ok('POST /api/generate', guardGenerateResponse, { body: { length: 128, symbols: false } });
  await api.ok('POST /api/generate', guardGenerateResponse, { body: { length: '16' } });
  const odd = await api.ok('POST /api/generate', guardGenerateResponse, { body: { length: 'abc' } });
  assert.equal(odd.password.length, 20);
  assert.equal(odd.bits, (await api.ok('POST /api/generate', guardGenerateResponse, { body: { length: 20 } })).bits);

  const nested = JSON.stringify({ encrypted: false, folders: [], items: [{ type: 1, name: 'Imported', login: { username: 'a', password: 'b' } }, { type: 5, name: 'Unsupported' }] });
  const body = { text: nested, folder: 'Imported' };
  const preview = await api.ok('POST /api/import', guardImportAnswer, { body: { ...body, dryRun: true } });
  assert.ok(isImportPreviewResponse(preview) && preview.count === 1 && preview.ignored === 1);
  assert.ok(!(await api.ok('GET /api/folders', guardFolderList)).includes('Imported'), 'a dry run changes nothing');
  const imported = await api.ok('POST /api/import', guardImportResponse, { body });
  assert.deepEqual([imported.added, imported.skipped, imported.ignored], [1, 0, 1]);
  assert.ok((await api.ok('GET /api/folders', guardFolderList)).includes('Imported'));
  const again = await api.ok('POST /api/import', guardImportResponse, { body });
  assert.deepEqual([again.added, again.skipped], [0, 1]);
  await api.error('POST /api/import', 400, { body: { text: 'not json' } });
  await api.error('POST /api/import', 400, { body: { text: '{"items": "no"}' } });

  await api.error('POST /api/export', 400, { body: { password } });
  await api.error('POST /api/export', 401, { body: { password: 'wrong-wrong-wrong', confirm: true } });
  const plain = await api.ok('POST /api/export', guardExportResponse, { body: { password, confirm: true } });
  assert.match(plain.filename, /^nullbrand-export-\d{4}-\d{2}-\d{2}\.json$/);
  const reread = await api.ok('POST /api/import', guardImportAnswer, { body: { text: plain.text, dryRun: true } });
  assert.ok(isImportPreviewResponse(reread) && reread.count > 0, 'what the server exports, the server imports');
  const backup = await api.call('GET /api/export/backup');
  assert.equal(backup.status, 200);
  assert.match(backup.contentDisposition ?? '', /attachment; filename="nullbrand-backup-\d{4}-\d{2}-\d{2}\.json"/);
  const backedUp = await readBackupItemsFromText(backup.text, password);
  const total = (await api.ok('GET /api/items', guardPublicItems)).length;
  assert.equal(backedUp.length, total, 'the exported backup holds every item');
  const merged = await api.ok('POST /api/import/backup', guardMergeResponse, { body: { text: backup.text, password } });
  assert.deepEqual([merged.added, merged.skipped], [0, total], 'importing the same backup adds nothing');
  await api.error('POST /api/import/backup', 401, { body: { text: backup.text, password: 'wrong-backup-password' } });
  await api.error('POST /api/import/backup', 400, { body: { text: 'not a backup', password } });

  if (thorough) await api.error('POST /api/password', 401, { body: { current: 'wrong-wrong-wrong', next: CHANGED_PW } });
  await api.ok('POST /api/password', guardOkResponse, { body: { current: password, next: CHANGED_PW } });
  await api.ok('POST /api/lock', guardOkResponse);
  const locked = await api.ok('GET /api/status', guardStatusResponse);
  assert.deepEqual([locked.unlocked, locked.count], [false, null]);
  await api.error('GET /api/items', 423);
  await api.ok('POST /api/unlock', guardOkResponse, { body: { password: CHANGED_PW } });
  assert.equal((await api.ok('GET /api/status', guardStatusResponse)).count, total);
  await api.ok('POST /api/destroy', guardOkResponse, { body: { password: CHANGED_PW } });
  await api.error('GET /api/status', 401);
}

test('contract (a): the legacy fixture vault — every route, every answer passes its guard', async () => {
  await withServer(
    async (_dir, vaultPath) => writeFile(vaultPath, await readFile(new URL('legacy-vault.json', FIX))),
    async (api) => walk(api, { password: FIX_PW, existing: true, thorough: true, expectedItems: 5 }),
  );
});

test('contract (b): a vault with extra fields and an empty createdAt — the guards are not stricter than the server', async () => {
  await withServer(
    async (_dir, vaultPath) => writeV2Vault(vaultPath, OWN_PW, { items: EXTRA_FIELDS_ITEMS, folders: ['Legacy'] }),
    async (api) => {
      await api.ok('POST /api/unlock', guardOkResponse, { body: { password: OWN_PW } });
      const listed = await api.ok('GET /api/items', guardPublicItems);
      assert.equal(listed.length, EXTRA_FIELDS_ITEMS.length);
      for (const entry of listed) assert.equal(entry.createdAt, '', 'an empty createdAt is a legitimate answer');
      const login = await api.ok('GET /api/items/:id', guardVaultItem, { id: 'x1' });
      const fields: Readonly<Record<string, unknown>> = login;
      assert.ok(Object.hasOwn(fields, 'futureField'), 'the extra property is still on the item');
      assert.deepEqual(fields['futureField'], { a: 1 });
      assert.equal(login.createdAt, '');
      await api.ok('POST /api/lock', guardOkResponse);
      await walk(api, { password: OWN_PW, existing: true, thorough: false, expectedItems: EXTRA_FIELDS_ITEMS.length });
    },
  );
});

test('contract (c): a vault created through the API', async () => {
  await withServer(
    async () => {},
    async (api) => walk(api, { password: OWN_PW, existing: false, thorough: false, expectedItems: 0 }),
  );
});

test('contract (d): POST /api/shutdown answers { ok: true } (guardShutdownAck) and then stops the server', async () => {
  let stopped = false;
  await withServer(
    async () => {},
    async (api) => {
      await api.ok('POST /api/shutdown', guardShutdownAck);
      for (let i = 0; i < 100 && !stopped; i++) await new Promise<void>((r) => setTimeout(() => r(), 20));
      assert.ok(stopped, 'onShutdown was called');
    },
    () => {
      stopped = true;
    },
  );
});

test('contract: every route of the server was walked, and the walk knows no route the server lacks', () => {
  assert.ok(SERVER_ROUTES.length >= 20, `routes found in the server: ${SERVER_ROUTES.length}`);
  const missing = SERVER_ROUTES.filter((route) => !covered.has(route));
  assert.deepEqual(missing, [], 'routes of the server that the contract test never called');
  const unknown = [...covered].filter((route) => !SERVER_ROUTES.includes(route) && route !== 'GET /api/nothing-here');
  assert.deepEqual(unknown, [], 'routes the contract test called that the server does not have');
});
