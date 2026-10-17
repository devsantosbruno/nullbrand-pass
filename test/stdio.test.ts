// Spec 09: EPIPE on stdout / stderr ends the process quietly; any other write error is reported and fails the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardStdio } from '../src/stdio.js';
import type { ErrorSource } from '../src/stdio.js';

const BIN = new URL('../bin/nullbrand.js', import.meta.url).pathname;

// Runs `nullbrand <args>` with `redirect` applied in sh, its output going to `true`, which exits at once without reading: by the
// time node has started the read end is closed, so the first write gets EPIPE. The exit code of the producer is saved to a file.
function pipeClosed(args: string, redirect: string) {
  const home = mkdtempSync(join(tmpdir(), 'nb-epipe-'));
  const codeFile = join(home, 'code');
  const script = `"$0" ${BIN} ${args} ${redirect}; echo $? > ${codeFile}`;
  const r = spawnSync('sh', ['-c', `{ ${script} ; } | true`, process.execPath], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', HOME: home, NULLBRAND_HOME: join(home, 'data'), NULLBRAND_LANG: 'en', NO_COLOR: '1' },
  });
  return { shell: r, code: readFileSync(codeFile, 'utf8').trim() };
}

test('stdout closed by the reader: exit 0, no stack trace', () => {
  const r = pipeClosed('help', '2>' + join(tmpdir(), `nb-epipe-err-${process.pid}`));
  assert.equal(r.code, '0');
  assert.equal(readFileSync(join(tmpdir(), `nb-epipe-err-${process.pid}`), 'utf8'), '');
});

test('stderr closed by the reader: exit 0, no stack trace', () => {
  // An unknown flag is warned about on stderr, then help succeeds on stdout (sent to /dev/null).
  const r = pipeClosed('--no-such-flag help', '2>&1 >/dev/null');
  assert.equal(r.code, '0');
  assert.equal(r.shell.stderr, '');
});

// process.exit() never returns; the fake stops the listener the same way.
class Exited extends Error {}

function fakeStream() {
  let listener: ((err: Error) => void) | undefined;
  const stream: ErrorSource = { on(_event, l) { listener = l; return stream; } };
  return { stream, emit(err: Error) { if (listener === undefined) assert.fail('no listener installed'); try { listener(err); } catch (e) { if (!(e instanceof Exited)) throw e; } } };
}

function errorWithCode(code: string): Error {
  return Object.assign(new Error(`write ${code}`), { code });
}

function harness() {
  const out = fakeStream();
  const err = fakeStream();
  const calls: string[] = [];
  guardStdio({ stdout: out.stream, stderr: err.stream }, {
    exit: () => { calls.push('exit'); throw new Exited(); },
    fail: () => { calls.push('fail'); },
    report: (e) => { calls.push(`report:${e instanceof Error ? e.message : String(e)}`); },
  });
  return { out, err, calls };
}

test('EPIPE on either stream exits without failing or reporting', () => {
  const h = harness();
  h.out.emit(errorWithCode('EPIPE'));
  h.err.emit(errorWithCode('EPIPE'));
  assert.deepEqual(h.calls, ['exit', 'exit']);
});

test('another stdout error is recorded as a failure and reported', () => {
  const h = harness();
  h.out.emit(errorWithCode('ENOSPC'));
  assert.deepEqual(h.calls, ['fail', 'report:write ENOSPC']);
});

test('another stderr error is a failure with nothing to report to', () => {
  const h = harness();
  h.err.emit(errorWithCode('EIO'));
  assert.deepEqual(h.calls, ['fail']);
});

test('an error without a code is not mistaken for EPIPE', () => {
  const h = harness();
  h.out.emit(new Error('boom'));
  assert.deepEqual(h.calls, ['fail', 'report:boom']);
});
