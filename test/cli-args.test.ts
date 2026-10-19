import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/nullbrand.js', import.meta.url));

function cli(args: string[], extraEnv: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'nb-args-'));
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env['PATH'] ?? '', HOME: home, NULLBRAND_HOME: join(home, 'data'), NULLBRAND_LANG: 'en', NO_COLOR: '1', ...extraEnv },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, home };
}

test('commands: names from Object.prototype are unknown commands (help + exit 1), not executed', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
    const r = cli([name]);
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, new RegExp(`Unknown command: ${name}`), name);
    assert.match(r.stdout, /get <query>/, `${name}: help is printed`);
  }
});

test('commands: the aliases (ls, gen) are own properties and keep working', () => {
  const g = cli(['gen', '--length', '12']);
  assert.equal(g.status, 0);
  assert.doesNotMatch(g.stderr, /Unknown command/);
  assert.ok(g.stdout.trim().length > 0);
  const l = cli(['ls']);
  assert.doesNotMatch(l.stderr, /Unknown command/);
});

test('parseArgs: a value flag without a value is an explicit error', () => {
  for (const args of [['generate', '--port'], ['generate', '--length'], ['generate', '-l'], ['generate', '--vault'], ['generate', '--lang']]) {
    const r = cli(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /expects a value/, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
  }
  assert.match(cli(['generate', '--port']).stderr, /--port expects a value\./);
  assert.match(cli(['generate', '-l']).stderr, /-l expects a value\./);
});

test('parseArgs: a value that starts with -- counts as missing and is not swallowed', () => {
  const r = cli(['ui', '--port', '--idle', '0']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--port expects a value\./);
  assert.doesNotMatch(r.stderr, /--idle expects/);
});

test('parseArgs: the error is translated', () => {
  const r = cli(['generate', '--port'], { NULLBRAND_LANG: 'pt' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--port espera um valor\./);
});

test('parseArgs: --help / --version win over a missing value', () => {
  assert.equal(cli(['--help', '--port']).status, 0);
  assert.equal(cli(['--version', '--port']).status, 0);
});

test('parseArgs: --x=a=b splits at the first "=" only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-eq-'));
  const path = join(dir, 'a=b.json');
  const r = cli([`--vault=${path}`, 'where']);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(path), r.stdout);
  assert.doesNotMatch(r.stderr, /Unknown option/);
});

test('parseArgs: unknown flags warn on stderr and the command still runs', () => {
  for (const flag of ['--copy', '--prot', '--no-prot', '--copy=1', '--=x']) {
    const r = cli(['generate', flag]);
    assert.equal(r.status, 0, flag);
    assert.match(r.stderr, new RegExp(`Unknown option \\(ignored\\): ${flag.replace(/[-=]/g, '\\$&')}`), flag);
    assert.ok(r.stdout.trim().length > 0, flag);
  }
  assert.match(cli(['generate', '--copy'], { NULLBRAND_LANG: 'pt' }).stderr, /Opção desconhecida \(ignorada\): --copy/);
});

test('parseArgs: known flags, --no-<flag> and anything after "--" do not warn', () => {
  for (const args of [['generate', '--no-digits', '--no-upper', '--no-lower', '--avoid-ambiguous'], ['generate', '--no-port'], ['generate', '--', '--copy'], ['generate', '--length=20']]) {
    const r = cli(args);
    assert.equal(r.status, 0, args.join(' '));
    assert.doesNotMatch(r.stderr, /Unknown option/, args.join(' '));
  }
});
