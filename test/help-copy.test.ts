import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { main } from '../src/cli.js';

// `get` already copies to the clipboard by default (`--show` prints, `--clear` / `--no-clear` control the wipe). There is no `--copy`
// flag, so neither the help text nor the locales may advertise one.
test('help: does not mention a --copy flag', async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    await main(['help']);
  } finally {
    console.log = original;
  }
  const text = lines.join('\n');
  assert.match(text, /get <query>/, 'the help was captured');
  assert.doesNotMatch(text, /--copy/);
});

test('locales: no string advertises a --copy flag', () => {
  for (const lang of ['en', 'pt']) {
    const raw = readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8');
    assert.doesNotMatch(raw, /--copy/, lang);
  }
});
