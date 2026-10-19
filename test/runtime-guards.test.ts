import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { run, createClipboard, ClipboardError } from '../src/clipboard.js';
import type { Backend } from '../src/clipboard.js';
import { resolveForProcess } from '../src/i18n.js';
import type { ChildProcess, ChildReadable, ChildWritable } from 'node:child_process';

const PROMPT_URL = new URL('../src/prompt.js', import.meta.url).href;
const childOut = (script: string, input: string) => execFileSync(process.execPath, ['--input-type=module', '-e', script], { input, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });

const WITHOUT_PRIVATE_API = `
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
const probe = createInterface({ input: new PassThrough() });
for (let p = Object.getPrototypeOf(probe); p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, '_writeToOutput')) delete p._writeToOutput;
probe.close();
`;

test('contract: readline still exposes the private _writeToOutput', () => {
  const out = childOut(`import { createInterface } from 'node:readline';
    import { PassThrough } from 'node:stream';
    const rl = createInterface({ input: new PassThrough() });
    console.log(typeof rl._writeToOutput); rl.close();`, '');
  assert.equal(out.trim(), 'function', 'API privada desapareceu: ver .spec/03-prompt-write-to-output.md');
});

test('prompt: a hidden (password) prompt works when readline still has the private _writeToOutput', () => {
  const out = childOut(`import { ask, closePrompt } from ${JSON.stringify(PROMPT_URL)};
    const pw = await ask('Password: ', { hidden: true }); const name = await ask('Name: ');
    closePrompt(); console.log(JSON.stringify({ pw, name }));`, 'secret\nbob\n');
  assert.match(out, /Password: /);
  assert.match(out, /\{"pw":"secret","name":"bob"\}/);
});

test('prompt: without _writeToOutput the password is NOT asked (typed error, question never printed); other prompts still work', () => {
  const out = childOut(`${WITHOUT_PRIVATE_API}
    const { ask, closePrompt } = await import(${JSON.stringify(PROMPT_URL)});
    let outcome; try { await ask('Password: ', { hidden: true }); outcome = 'ASKED'; } catch (e) { outcome = 'refused ' + e.key; }
    const name = await ask('Name: ');
    closePrompt(); console.log('\\n' + JSON.stringify({ outcome, name }));`, 'bob\n');
  assert.doesNotMatch(out, /Password: /, 'the password question was not even printed');
  assert.match(out, /\{"outcome":"refused err\.prompt\.cannotMask","name":"bob"\}/);
});

class FakeReadable extends EventEmitter implements ChildReadable {}
class FakePipe implements ChildWritable {
  readonly chunks: (string | Uint8Array | undefined)[] = [];
  on(_event: 'error', _listener: (err: Error) => void): this {
    return this;
  }
  end(chunk?: string | Uint8Array): this {
    this.chunks.push(chunk);
    return this;
  }
}
class FakeChild extends EventEmitter implements ChildProcess {
  killed = 0;
  constructor(
    readonly stdin: ChildWritable | null | undefined,
    readonly stdout: FakeReadable | null = null,
  ) {
    super();
  }
  kill(): boolean {
    this.killed++;
    return true;
  }
  unref(): void {}
}
const fakeChild = ({ stdin, stdout = null }: { stdin: ChildWritable | null | undefined; stdout?: FakeReadable | null }) => new FakeChild(stdin, stdout);
const pipe = () => new FakePipe();

for (const missing of [null, undefined]) {
  test(`clipboard.run: stdin ${missing} is an explicit rejection (and the child is stopped), never a silent no-op`, async () => {
    const child = fakeChild({ stdin: missing });
    const e = await run('pbcopy', [], { input: 'secret', spawnFn: () => child }).then(() => assert.fail('must reject'), (err: unknown) => err);
    assert.ok(e instanceof ClipboardError);
    assert.equal(e.key, 'err.clipboard.run');
    assert.equal(e.params['reason'], 'no stdin pipe');
    assert.equal(child.killed, 1);
  });
}

test('clipboard: a clear that cannot reach the tool is reported as failed (the read showed the secret), never as cleared', async () => {
  let writes = 0;
  const okChild = () => {
    const stdout = new FakeReadable();
    const c = fakeChild({ stdin: pipe(), stdout });
    setImmediate(() => { stdout.emit('data', Buffer.from('secret')); c.emit('close', 0); c.emit('exit', 0); });
    return c;
  };
  const noStdin = () => fakeChild({ stdin: null });
  const backend: Backend = {
    name: 'fake',
    write: async () => { writes++; return ''; },
    read: () => run('x', [], { capture: true, spawnFn: okChild }),
    clear: () => run('x', [], { input: '', spawnFn: noStdin }),
  };
  const clip = createClipboard({ backend, ttlMs: 60_000 });
  const copied = await clip.copy('secret');
  assert.equal(writes, 1);
  assert.equal(await clip.flush(), 'failed');
  assert.equal(await copied.done, 'failed');
  assert.equal(clip.pending, false);
});

test('clipboard: a copy whose write cannot reach the tool rejects, and the previous pending clear stays in effect', async () => {
  let fail = false;
  const backend: Backend = {
    name: 'fake',
    write: async () => { if (fail) await run('x', [], { input: 's', spawnFn: () => fakeChild({ stdin: null }) }); return ''; },
    read: async () => 'first',
    clear: async () => '',
  };
  const clip = createClipboard({ backend, ttlMs: 60_000 });
  await clip.copy('first');
  assert.equal(clip.pending, true);
  fail = true;
  const e = await clip.copy('second').then(() => assert.fail('must reject'), (err: unknown) => err);
  assert.ok(e instanceof ClipboardError);
  assert.equal(e.key, 'err.clipboard.run');
  assert.equal(clip.pending, true, 'the first copy is still waiting to be cleared');
  assert.equal(await clip.flush(), 'cleared');
});

test('resolveForProcess without a data directory still ignores the config file, as before', () => {
  const r = resolveForProcess({ env: { NULLBRAND_LANG: 'pt' } });
  assert.deepEqual(r, { lang: 'pt', source: 'env', warnings: [] });
  assert.equal(resolveForProcess({ env: {}, system: 'en-US' }).source, 'system');
});

const askTwice = `import { ask, closePrompt } from ${JSON.stringify(PROMPT_URL)};
  const out = [];
  for (const [q, o] of [['A: ', {}], ['B: ', { hidden: true }]]) {
    try { out.push(await ask(q, o)); } catch (e) { out.push('rejected ' + e.key); }
  }
  closePrompt(); console.log('\\n' + JSON.stringify(out));`;
const closedRun = (input: string) => execFileSync(process.execPath, ['--input-type=module', '-e', askTwice], { input, encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_NO_WARNINGS: '1' } });

test('prompt: two lines then EOF answer both questions', () => {
  assert.match(closedRun('a\nb\n'), /\["a","b"\]/);
});

test('prompt: one line then EOF rejects the second question with err.inputClosed', () => {
  assert.match(closedRun('a\n'), /\["a","rejected err\.inputClosed"\]/);
});

test('prompt: EOF before the first question rejects both, and the hidden question is never printed', () => {
  const out = closedRun('');
  assert.match(out, /\["rejected err\.inputClosed","rejected err\.inputClosed"\]/);
  assert.doesNotMatch(out, /B: /);
});

test('prompt: an ask() made well after the close (queue empty) rejects instead of hanging', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `import { ask, closePrompt } from ${JSON.stringify(PROMPT_URL)};
    await ask('A: '); await new Promise((r) => setTimeout(r, 100));
    try { await ask('B: '); console.log('\\nASKED'); } catch (e) { console.log('\\n' + e.key); }
    closePrompt();`], { input: 'a\n', encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  assert.match(out, /err\.inputClosed/);
  assert.doesNotMatch(out, /B: /);
});
