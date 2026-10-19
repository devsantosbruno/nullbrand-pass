// The browser code looks elements up by id and the HTML is its own. There is no DOM in the test runner, so this checks the contract
// from both sides: every `#id` the code asks for is in index.html, and every data-i18n key the HTML uses is in both dictionaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { at, readDictFile, walkFiles } from './support.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => at(m, 1)));

test('every #id the web code looks up exists in index.html', async () => {
  const lookups = new Set<string>();
  for (const file of (await walkFiles(publicDir)).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(`${publicDir}${file}`, 'utf8');
    // $('#x'), $input('#x'), $button('#x'), $dialog('#x'), $form('#x'), $textarea('#x'), query(document, '#x', ...), '#x' in a selector list
    for (const m of code.matchAll(/(?:\$\w*\(|query\(document, )'#([\w-]+)'/g)) lookups.add(at(m, 1));
  }
  assert.ok(lookups.size > 80, `lookups found: ${lookups.size}`);
  assert.deepEqual([...lookups].filter((id) => !ids.has(id)).sort(), []);
});

test('every data-i18n key of index.html is in both dictionaries', () => {
  const en = readDictFile(new URL('../locales/en.json', import.meta.url));
  const pt = readDictFile(new URL('../locales/pt.json', import.meta.url));
  const keys = new Set([...html.matchAll(/\bdata-i18n(?:-title|-placeholder|-aria)?="([\w.]+)"/g)].map((m) => at(m, 1)));
  assert.ok(keys.size > 100, `keys found: ${keys.size}`);
  const missing = [...keys].filter((k) => !Object.hasOwn(en, k) || !Object.hasOwn(pt, k));
  assert.deepEqual(missing, []);
});

test('index.html ids are unique', () => {
  const all = [...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => at(m, 1));
  assert.deepEqual(all.filter((id, k) => all.indexOf(id) !== k), []);
});
