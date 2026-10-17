import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipboard, detectBackend, macBackend, windowsBackend, waylandBackend, xclipBackend, xselBackend, installExitHooks, ClipboardError } from '../src/clipboard.js';
import type { Backend, ExitHookProcess, RunOptions } from '../src/clipboard.js';
import { EventEmitter } from 'node:events';
import type { TestContext } from 'node:test';

// In-memory backend: the "clipboard" is a string; `calls` records what was done.
type FakeCall = ['write', { sensitive?: boolean } | undefined] | ['read'] | ['clear'];
interface FakeBackend extends Backend {
  content: string;
  calls: FakeCall[];
}
function fakeBackend({ failRead = false, failWrite = false } = {}): FakeBackend {
  const b: FakeBackend = {
    name: 'fake',
    content: '',
    calls: [],
    async write(text, opts) {
      if (failWrite) throw new ClipboardError('failed', 'err.clipboard.run');
      b.calls.push(['write', opts]);
      b.content = text;
      return '';
    },
    async read() {
      b.calls.push(['read']);
      if (failRead) throw new ClipboardError('failed', 'err.clipboard.run');
      return b.content;
    },
    async clear() {
      b.calls.push(['clear']);
      b.content = '';
      return '';
    },
  };
  return b;
}
const timers = (t: TestContext) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

test('clears when the timer fires and the clipboard still has the password', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 30_000 });
  const r = await clip.copy('s3cret!');
  assert.equal(b.content, 's3cret!');
  assert.equal(r.ttlMs, 30_000);
  t.mock.timers.tick(29_999);
  await clip.idle();
  assert.equal(b.content, 's3cret!', 'does not clear early');
  t.mock.timers.tick(1);
  assert.equal(await r.done, 'cleared');
  assert.equal(b.content, '');
  assert.equal(clip.pending, false);
});

test('does not clear if the user copied something else afterwards', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 1000 });
  const r = await clip.copy('s3cret!');
  b.content = 'something else'; // copy made outside nullbrand
  t.mock.timers.tick(1000);
  assert.equal(await r.done, 'changed');
  assert.equal(b.content, 'something else');
  assert.ok(!b.calls.some((c) => c[0] === 'clear'));
});

test('does not clear blindly if the clipboard cannot be read', async (t) => {
  timers(t);
  const b = fakeBackend({ failRead: true });
  const clip = createClipboard({ backend: b, ttlMs: 1000 });
  const r = await clip.copy('s3cret!');
  t.mock.timers.tick(1000);
  assert.equal(await r.done, 'unverified');
  assert.equal(b.content, 's3cret!');
});

test('read ok but clear fails: reported as failed (the password is still there), not unverified', async (t) => {
  timers(t);
  const b = fakeBackend();
  b.clear = async () => {
    b.calls.push(['clear']);
    throw new ClipboardError('failed', 'err.clipboard.run');
  };
  const clip = createClipboard({ backend: b, ttlMs: 1000 });
  const r = await clip.copy('s3cret!');
  t.mock.timers.tick(1000);
  assert.equal(await r.done, 'failed');
  assert.equal(b.content, 's3cret!');
  assert.equal(clip.pending, false);
});

test('read ok and clear ok: cleared', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 1000 });
  const r = await clip.copy('s3cret!');
  t.mock.timers.tick(1000);
  assert.equal(await r.done, 'cleared');
  assert.equal(b.content, '');
});

test('a new copy cancels the previous timer and restarts the countdown', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 10_000 });
  const first = await clip.copy('first');
  t.mock.timers.tick(8000);
  const second = await clip.copy('second');
  assert.equal(await first.done, 'replaced');
  t.mock.timers.tick(8000); // 16 s since the first, 8 s since the second
  await clip.idle();
  assert.equal(b.content, 'second', 'the old timer must not clear the new copy');
  t.mock.timers.tick(2000);
  assert.equal(await second.done, 'cleared');
  assert.equal(b.content, '');
});

test('flush (lock/quit) follows the rule and is idempotent', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 30_000 });
  await clip.copy('s3cret!');
  const [a, c] = await Promise.all([clip.flush(), clip.flush()]);
  assert.deepEqual([a, c], ['cleared', 'none']);
  assert.equal(b.calls.filter((x) => x[0] === 'clear').length, 1);

  await clip.copy('s3cret!');
  b.content = 'other';
  assert.equal(await clip.flush(), 'changed');
  assert.equal(b.content, 'other');
  assert.equal(await clip.flush(), 'none');
});

test('ttl 0 only copies: no timer, no clearing on flush', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 0 });
  const r = await clip.copy('visible');
  assert.equal(await r.done, 'disabled');
  assert.equal(clip.pending, false);
  assert.equal(await clip.flush(), 'none');
  assert.equal(b.content, 'visible');
});

test('copying without ttl (non-sensitive) forgets the previous password', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 30_000 });
  const pw = await clip.copy('s3cret!');
  await clip.copy('user@x.com', { sensitive: false, ttlMs: 0 });
  assert.equal(await pw.done, 'replaced');
  assert.equal(await clip.flush(), 'none');
  assert.equal(b.content, 'user@x.com');
});

test('a write failure propagates the error and keeps the previous timer', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 1000 });
  const r = await clip.copy('s3cret!');
  b.write = async () => { throw new ClipboardError('no tool', 'err.clipboard.run'); };
  await assert.rejects(clip.copy('other'), /no tool/);
  t.mock.timers.tick(1000);
  assert.equal(await r.done, 'cleared');
});

test('in every backend the password goes through stdin, never in arguments', async () => {
  const SECRET = 'SECRET-PASSWORD-123';
  const backends = [macBackend, windowsBackend, waylandBackend, xclipBackend, xselBackend];
  for (const make of backends) {
    const calls: { cmd: string; args: readonly string[]; input: string | Uint8Array | undefined }[] = [];
    const b = make(async (cmd, args, opts: RunOptions = {}) => (calls.push({ cmd, args, input: opts.input }), ''));
    await b.write(SECRET, { sensitive: true });
    await b.read();
    await b.clear();
    for (const c of calls) assert.ok(!c.args.join(' ').includes(SECRET), `${b.name}: ${c.cmd} received the password in args`);
    assert.ok(calls.some((c) => c.input && (Buffer.isBuffer(c.input) ? c.input.toString('utf16le') : String(c.input)).includes(SECRET)), `${b.name}: the password did not go through stdin`);
  }
});

test('windows: text goes as UTF-16LE with BOM (accents preserved in clip.exe)', async () => {
  let sent: string | Uint8Array | undefined;
  await windowsBackend(async (cmd, _args, { input }: RunOptions = {}) => { if (cmd === 'clip.exe') sent = input; return ''; }).write('action');
  assert.ok(Buffer.isBuffer(sent));
  assert.deepEqual([...sent.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(sent.toString('utf16le'), '\uFEFFaction');
});

test('the text goes to the backend marked as sensitive by default', async () => {
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 0 });
  await clip.copy('x');
  await clip.copy('y', { sensitive: false });
  assert.deepEqual(b.calls.flatMap((c) => (c[0] === 'write' ? [c[1]?.sensitive] : [])), [true, false]);
});

// A stand-in for `process`: an EventEmitter that also has exit(). The hooks are given their own `exit` function, so this one must never run.
class FakeProcess extends EventEmitter implements ExitHookProcess {
  exit(): never {
    throw new Error('process.exit must not be called');
  }
}

test('exit hooks: signal clears and exits; beforeExit clears; removal disables', async (t) => {
  timers(t);
  const b = fakeBackend();
  const clip = createClipboard({ backend: b, ttlMs: 30_000 });
  const proc = new FakeProcess();
  const exits: number[] = [];
  const off = installExitHooks(clip, { proc, exit: (c) => void exits.push(c) });

  await clip.copy('s3cret!');
  proc.emit('SIGINT');
  await clip.idle();
  await new Promise<void>((r) => setImmediate(() => r()));
  assert.equal(b.content, '');
  assert.deepEqual(exits, [130]);

  await clip.copy('s3cret!');
  proc.emit('beforeExit');
  await clip.idle();
  assert.equal(b.content, '');

  off();
  assert.equal(proc.listenerCount('SIGINT') + proc.listenerCount('beforeExit'), 0);
});

test('detectBackend picks the right tool per platform', async () => {
  const has = (...present: string[]) => async (c: string) => present.includes(c);
  assert.match((await detectBackend({ platform: 'darwin' })).name, /macOS/);
  assert.match((await detectBackend({ platform: 'win32' })).name, /Windows/);
  const wl = await detectBackend({ platform: 'linux', env: { WAYLAND_DISPLAY: 'w', DISPLAY: ':0' }, has: has('wl-copy', 'wl-paste', 'xclip') });
  assert.match(wl.name, /Wayland/);
  const xc = await detectBackend({ platform: 'linux', env: { DISPLAY: ':0' }, has: has('xclip', 'xsel') });
  assert.match(xc.name, /xclip/);
  const xs = await detectBackend({ platform: 'linux', env: { DISPLAY: ':0' }, has: has('xsel') });
  assert.match(xs.name, /xsel/);
});

test('detectBackend gives a clear error when a tool is missing', async () => {
  const none = async () => false;
  await assert.rejects(detectBackend({ platform: 'linux', env: { WAYLAND_DISPLAY: 'w' }, has: none }), /wl-clipboard/);
  await assert.rejects(detectBackend({ platform: 'linux', env: { DISPLAY: ':0' }, has: none }), /xclip or xsel/);
  await assert.rejects(detectBackend({ platform: 'linux', env: {}, has: none }), /No graphical session/);
});
