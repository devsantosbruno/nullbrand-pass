import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createT, fmtRelative, fmtDate, errText } from '../src/shared/i18n.js';
import { fileURLToPath } from 'node:url';
import { at, entryOf, readDictFile, thrownKey, thrownMessage, walkFiles } from './support.js';

const load = (l: string) => readDictFile(new URL(`../locales/${l}.json`, import.meta.url));
const en = load('en');
const pt = load('pt');
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test('en.json and pt.json have exactly the same keys', () => {
  const a = Object.keys(en).sort();
  const b = Object.keys(pt).sort();
  assert.deepEqual(a.filter((k) => !Object.hasOwn(pt, k)), [], 'keys missing in pt.json');
  assert.deepEqual(b.filter((k) => !Object.hasOwn(en, k)), [], 'keys missing in en.json');
});

test('placeholders {…} match between en and pt for every key', () => {
  for (const k of Object.keys(en)) {
    assert.deepEqual(placeholders(entryOf(pt, k)), placeholders(entryOf(en, k)), `placeholders differ for "${k}"`);
  }
});

test('every value is a non-empty string and plural keys come in complete pairs', () => {
  for (const dict of [en, pt]) {
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', k);
      assert.ok(v.length > 0, `${k} is empty`);
      if (k.endsWith('_one')) assert.ok(Object.hasOwn(dict, `${k.slice(0, -4)}_other`), `${k} has no _other`);
      if (k.endsWith('_other')) assert.ok(Object.hasOwn(dict, `${k.slice(0, -6)}_one`) || !Object.hasOwn(en, `${k.slice(0, -6)}_one`), k);
    }
  }
});

test('voice: no exclamation marks and no emoji in either language', () => {
  for (const dict of [en, pt]) {
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(!v.includes('!'), `${k} has "!"`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(v), `${k} has an emoji`);
    }
  }
});

test('t(): interpolation, fallback to en, then the key itself', () => {
  const dicts = { en: { 'a.hello': 'Hello {name}', 'a.onlyEn': 'only en' }, pt: { 'a.hello': 'Olá {name}' } };
  const t = createT('pt', dicts);
  assert.equal(t('a.hello', { name: 'Ana' }), 'Olá Ana');
  assert.equal(t('a.onlyEn'), 'only en', 'missing in pt -> en');
  assert.equal(t('a.nowhere'), 'a.nowhere', 'missing in both -> the key');
  assert.equal(t('a.hello'), 'Olá {name}', 'a missing param keeps the placeholder');
  assert.equal(createT('en', dicts)('a.hello', { name: 'Ann' }), 'Hello Ann');
});

test('t(): plurals via Intl.PluralRules', () => {
  const dicts = { en: { 'x_one': '{count} item', 'x_other': '{count} items' }, pt: { 'x_one': '{count} item', 'x_other': '{count} itens' } };
  assert.equal(createT('en', dicts)('x', { count: 1 }), '1 item');
  assert.equal(createT('en', dicts)('x', { count: 2 }), '2 items');
  assert.equal(createT('pt', dicts)('x', { count: 0 }), '0 item', 'pt treats 0 as singular');
  assert.equal(createT('pt', dicts)('x', { count: 5 }), '5 itens');
  const real = createT('pt', { en, pt });
  assert.equal(real('delete.done', { count: 3 }), '3 itens apagados');
});

test('relative time and dates use Intl, in the active language', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(fmtRelative('en', ago(2 * 60_000), now), '2 min ago');
  assert.equal(fmtRelative('pt', ago(2 * 60_000), now), 'há 2 min');
  assert.match(fmtRelative('pt', ago(3 * 3600_000), now), /^há 3 h/);
  assert.equal(fmtRelative('en', ago(10 * 86400_000), now), fmtDate('en', ago(10 * 86400_000)), 'older than a week -> absolute date');
  assert.notEqual(fmtDate('en', '2026-10-13T12:00:00Z'), fmtDate('pt', '2026-10-13T12:00:00Z'));
});

test('errText(): translates by key, falls back to the message', () => {
  const t = createT('pt', { en, pt });
  assert.equal(errText(t, { key: 'err.wrongPassword', message: 'x' }), 'Senha mestra incorreta. O cofre continua bloqueado.');
  assert.equal(errText(t, { key: 'err.unknown.key', message: 'raw' }), 'raw');
  assert.equal(errText(t, new Error('plain')), 'plain');
});

test('every i18n key referenced in src/ and public/ exists in both dictionaries', async () => {
  const { readdir } = await import('node:fs/promises');
  const files: URL[] = [];
  for (const dir of ['../src/', '../src/formats/']) {
    for (const f of await readdir(new URL(dir, import.meta.url))) if (f.endsWith('.js') || f.endsWith('.html')) files.push(new URL(dir + f, import.meta.url));
  }
  const publicDir = new URL('../public/', import.meta.url);
  for (const f of await walkFiles(fileURLToPath(publicDir))) if (f.endsWith('.js') || f.endsWith('.html')) files.push(new URL(f, publicDir));
  const prefixes = 'err|cli|help|field|ssh|type|filter|sel|list|folder|folders|delete|move|val|pw|tools|gen|setup|unlock|quit|destroy|menu|sidebar|nav|nosession|copied|copy|aria|strength|meta|fav|edit|password|reveal|notes|identity|placeholder|import|export|clipboard|server|warn|lang|detail|item|sshpub|sshover|common';
  const re = new RegExp(`['"\`=]((?:${prefixes})\\.[A-Za-z0-9.]+)['"\`]`, 'g');
  const dynamic = /^(strength|reveal\.\w+|warn\.permFixed|cli\.field|cli\.kind|type)\.$/;
  const missing = new Set<string>();
  for (const f of files) {
    for (const match of readFileSync(f, 'utf8').matchAll(re)) {
      const key = at(match, 1);
      const base = key.replace(/_(one|other)$/, '');
      const ok = [key, base, `${base}_other`].some((k) => Object.hasOwn(en, k) && Object.hasOwn(pt, k));
      if (!ok && !dynamic.test(key) && !key.endsWith('.com')) missing.add(`${key}  (${f.pathname.split('/').pop()})`);
    }
  }
  assert.deepEqual([...missing], []);
});

test('library errors carry the keys the dictionaries expect', async () => {
  const { WrongPasswordError } = await import('../src/crypto.js');
  const { generatePassword } = await import('../src/generator.js');
  const { planImport } = await import('../src/formats/index.js');
  assert.equal(new WrongPasswordError().key, 'err.wrongPassword');
  assert.throws(() => generatePassword({ upper: false, lower: false, digits: false, symbols: false }), (e) => thrownKey(e) === 'err.gen.noCharset' && /character type/.test(thrownMessage(e)));
  assert.throws(() => planImport('nope'), (e) => thrownKey(e) === 'err.import.notJson');
});
