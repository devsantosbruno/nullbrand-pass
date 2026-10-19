// Threat: another (non-root) user on the same computer. Permissions, argv/env of subprocesses
// and rejection of everything without a session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, stat, mkdir, writeFile, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Vault, hardenPermissions, backupVaultFile } from '../src/vault.js';
import { startServer } from '../src/server.js';
import type { RunOptions } from '../src/clipboard.js';
import { run, macBackend, windowsBackend, waylandBackend, xclipBackend, xselBackend } from '../src/clipboard.js';
import { openBrowser } from '../src/system.js';
import type { SpawnFn } from '../src/system.js';
import type { ChildProcess, ChildReadable, ChildWritable, SpawnOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { at, present, thrownMessage, walkFiles } from './support.js';

const posix = process.platform !== 'win32';
const skip = posix ? false : 'POSIX permissions do not apply to Windows';
const mode = async (p: string) => (await stat(p)).mode & 0o777;
const SECRET = 'S3cr3t-ultra-9f2c';

// ---------- creation modes ----------

test('directory 0700 and files 0600 at creation, even with umask 000', { skip }, async () => {
  const old = process.umask(0o000);
  const base = await mkdtemp(join(tmpdir(), 'nb-mode-'));
  try {
    const dir = join(base, 'a', '.nullbrand');
    const path = join(dir, 'vault.json');
    const v = await Vault.create('strong-master-password', path);
    assert.equal(await mode(dir), 0o700);
    assert.equal(await mode(path), 0o600);
    const bak = await backupVaultFile(path);
    assert.equal(await mode(bak), 0o600);
    const exp = join(base, 'fresh', 'backup.json');
    await v.exportBackup(exp);
    assert.equal(await mode(exp), 0o600);
    assert.equal(await mode(join(base, 'fresh')), 0o700);
    // nothing is left behind (temporary files) nor created outside the vault directory
    assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith('.tmp')), []);
  } finally {
    process.umask(old);
    await rm(base, { recursive: true });
  }
});

test('no module uses the system temp directory, a shell or env with secrets', () => {
  for (const f of readdirSync(new URL('../src/', import.meta.url)).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /tmpdir|TMPDIR/, `${f} uses the shared tmp`);
    assert.doesNotMatch(src, /shell:\s*true/, `${f} uses a shell`);
    for (const m of src.matchAll(/import \{([^}]*)\} from 'node:child_process'/g)) assert.equal(at(m, 1).trim(), 'spawn', `${f} imports more than spawn`);
  }
  const cli = readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');
  assert.doesNotMatch(cli, /flags\.(password|token|secret)/, 'the CLI does not accept secrets via flags');
});

// ---------- fix on startup ----------

test('open permissions are fixed on startup, with a warning', { skip }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'nb-fix-'));
  try {
    const dir = join(base, '.nullbrand');
    const path = join(dir, 'vault.json');
    await Vault.create('strong-master-password', path);
    const bak = await backupVaultFile(path);
    await chmod(dir, 0o755);
    await chmod(path, 0o644);
    await chmod(bak, 0o664);
    const msgs = await hardenPermissions(path);
    assert.equal(msgs.length, 3);
    assert.equal(await mode(dir), 0o700);
    assert.equal(await mode(path), 0o600);
    assert.equal(await mode(bak), 0o600);
    assert.deepEqual(await hardenPermissions(path), [], 'second run has nothing to fix');
  } finally {
    await rm(base, { recursive: true });
  }
});

test('an open data directory is fixed even before a vault exists; a foreign directory (--vault) is not touched', { skip }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'nb-fix2-'));
  try {
    const own = join(base, '.nullbrand');
    await mkdir(own, { mode: 0o755 });
    await chmod(own, 0o755);
    assert.equal((await hardenPermissions(join(own, 'vault.json'))).length, 1);
    assert.equal(await mode(own), 0o700);
    const other = join(base, 'project');
    await mkdir(other, { mode: 0o755 });
    await chmod(other, 0o755);
    await hardenPermissions(join(other, 'vault.json'));
    assert.equal(await mode(other), 0o755);
  } finally {
    await rm(base, { recursive: true });
  }
});

test('refuses a directory or vault owned by another user', { skip }, async () => {
  // getuid() is absent on Windows only, where this test is skipped.
  if (process.getuid === undefined) assert.fail('process.getuid is not available on this platform');
  const base = await mkdtemp(join(tmpdir(), 'nb-own-'));
  try {
    const dir = join(base, '.nullbrand');
    await mkdir(dir, { mode: 0o700 });
    await writeFile(join(dir, 'vault.json'), '{}', { mode: 0o600 });
    await assert.rejects(hardenPermissions(join(dir, 'vault.json'), { uid: process.getuid() + 1 }), /another user/);
    await hardenPermissions(join(dir, 'vault.json'));
  } finally {
    await rm(base, { recursive: true });
  }
});

// ---------- subprocesses: no secrets in argv/env ----------

// A child process that records what was written to its stdin and "exits" with code 0 once stdin is ended.
class FakeStdin implements ChildWritable {
  constructor(private readonly onEnd: (chunk: string | Uint8Array | undefined) => void) {}
  // The code registers an 'error' listener; this fake never fails a write, so there is nothing to keep.
  on(_event: 'error', _listener: (err: Error) => void): this {
    return this;
  }
  end(chunk?: string | Uint8Array): this {
    this.onEnd(chunk);
    return this;
  }
}
class FakeChild extends EventEmitter implements ChildProcess {
  readonly stdin: FakeStdin;
  readonly stdout: ChildReadable = {
    on() {
      return this;
    },
  };
  constructor(chunks: Buffer[]) {
    super();
    this.stdin = new FakeStdin((d) => {
      chunks.push(d === undefined || typeof d === 'string' ? Buffer.from(d ?? '') : Buffer.from(d));
      setImmediate(() => this.emit('exit', 0));
    });
  }
  unref(): void {}
  kill(): boolean {
    return true;
  }
}

interface SpawnCall {
  cmd: string;
  args: readonly string[];
  options: SpawnOptions | undefined;
  stdin: Buffer[];
}
function fakeSpawn(): { fn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const fn: SpawnFn = (cmd, args, options) => {
    const chunks: Buffer[] = [];
    const child = new FakeChild(chunks);
    calls.push({ cmd, args, options, stdin: chunks });
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  return { fn, calls };
}


test('clipboard: the password goes only through stdin; argv, env and shell carry no secret', async () => {
  const backends = [macBackend, windowsBackend, waylandBackend, xclipBackend, xselBackend];
  for (const make of backends) {
    const { fn, calls } = fakeSpawn();
    const exec = (cmd: string, args: readonly string[], o?: RunOptions) => run(cmd, args, { ...o, spawnFn: fn });
    const b = make(exec);
    await b.write(SECRET, { sensitive: true });
    await b.clear();
    assert.ok(calls.length >= 2);
    for (const c of calls) {
      const options = present(c.options, 'spawn options');
      assert.equal(options.shell, false, `${b.name}: shell`);
      assert.ok(!options.env, `${b.name}: a custom env should not exist`);
      assert.ok(!c.args.join('\u0000').includes(SECRET), `${b.name}: secret in argv of ${c.cmd}`);
      assert.ok(!c.cmd.includes(SECRET));
    }
    const sent = Buffer.concat(at(calls, 0).stdin);
    const plain = sent.includes(Buffer.from(SECRET)) || sent.includes(Buffer.from(SECRET, 'utf16le'));
    assert.ok(plain, `${b.name}: the password should go through stdin`);
  }
  assert.ok(!Object.values(process.env).some((v) => v?.includes(SECRET)));
});

test('browser: only the URL (single-use token) goes in argv, with no shell and no extra env', async () => {
  const platforms: NodeJS.Platform[] = ['darwin', 'linux', 'win32'];
  for (const platform of platforms) {
    const { fn, calls } = fakeSpawn();
    assert.equal(await openBrowser('http://127.0.0.1:5000/auth?t=abc', { spawnFn: fn, platform }), true);
    const c = at(calls, 0);
    const options = present(c.options, 'spawn options');
    assert.ok(!options.shell && !options.env);
    assert.equal(c.args.filter((a) => a.includes('abc')).length, 1);
    assert.ok(['open', 'xdg-open', 'rundll32'].includes(c.cmd));
  }
});

// ---------- every route requires a session ----------

interface RawResponse {
  status: number | undefined;
  body: string;
  headers: IncomingHttpHeaders;
}
function rawReq(
  port: number,
  { method = 'GET', path, headers = {}, body }: { method?: string; path: string; headers?: Record<string, string>; body?: string | undefined },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('without a session, ALL routes (API, static and unknown) answer 401 with no data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nb-routes-'));
  const srv = await startServer({ vaultPath: join(dir, 'vault.json') });
  try {
    // Reads the routes from server.js itself: a new route enters the test automatically. (Compiled output indents deeper than the old
    // source did, hence `\s+` instead of exactly four spaces.)
    const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
    const keys = [...source.matchAll(/^\s+'((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^']*)'/gm)].map((m) => at(m, 1));
    assert.ok(keys.length >= 20, `routes found: ${keys.length}`);
    // Every file the build ships to the browser (modules in subfolders included) plus a few that do not exist: all behind the same wall.
    const shipped = (await walkFiles(fileURLToPath(new URL('../public/', import.meta.url)))).filter((f) => !f.endsWith('.d.ts')).map((f) => `/${f}`);
    assert.ok(shipped.includes('/app.js') && shipped.includes('/styles.css'), `shipped files: ${shipped.join(', ')}`);
    const statics = ['/', ...shipped, '/api', '/anything', '/api/does-not-exist'];
    const targets = [
      ...keys.map((k) => { const [method = '', p = ''] = k.split(' '); return { method, path: p.replace(/:\w+/g, 'x') }; }),
      ...statics.map((path) => ({ method: 'GET', path })),
    ];
    const origin = `http://127.0.0.1:${srv.port}`;
    for (const t of targets) {
      for (const cookie of [undefined, 'nullbrand_sid_0=invalid', `x=${srv.token}`]) {
        const headers = { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) };
        const r = await rawReq(srv.port, { ...t, headers, body: ['POST', 'PUT', 'PATCH'].includes(t.method) ? '{}' : undefined }).catch((e: unknown) => assert.fail(`${t.method} ${t.path}: ${thrownMessage(e)}`));
        assert.equal(r.status, 401, `${t.method} ${t.path} (${cookie ?? 'no cookie'}) → ${r.status}`);
        assert.doesNotMatch(r.body, /<html|vault|exists|unlocked/i);
      }
    }
    // the token in the query of any route is not valid; only /auth exchanges it
    assert.equal((await rawReq(srv.port, { path: `/api/status?t=${srv.token}` })).status, 401);
    assert.equal((await rawReq(srv.port, { path: '/auth' })).status, 403);
  } finally {
    await srv.close();
    await rm(dir, { recursive: true });
  }
});
