import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLang, normalizeLang } from '../src/shared/i18n.js';
import { resolveForProcess, saveLang, readConfig, configPath } from '../src/i18n.js';
import { parseJson } from './support.js';

test('normalizeLang: pt-* becomes pt, en-* becomes en, the rest is rejected', () => {
  assert.equal(normalizeLang('pt'), 'pt');
  assert.equal(normalizeLang('pt-BR'), 'pt');
  assert.equal(normalizeLang('pt_PT.UTF-8'), 'pt');
  assert.equal(normalizeLang('EN-us'), 'en');
  for (const bad of ['fr', 'es-ES', 'xx', '', 'portuguese', null, undefined, 42]) assert.equal(normalizeLang(bad), null, String(bad));
});

test('precedence: flag > env > config > system > en', () => {
  const all = { flag: 'en', env: 'pt', config: 'pt', system: 'pt-BR' };
  assert.deepEqual(resolveLang(all), { lang: 'en', source: 'flag', warnings: [] });
  assert.equal(resolveLang({ ...all, flag: undefined }).source, 'env');
  assert.equal(resolveLang({ ...all, flag: undefined, env: undefined }).source, 'config');
  const sys = resolveLang({ system: 'pt-BR' });
  assert.deepEqual([sys.lang, sys.source], ['pt', 'system']);
  assert.deepEqual(resolveLang({}), { lang: 'en', source: 'default', warnings: [] });
  assert.deepEqual(resolveLang({ flag: 'pt', env: 'en', config: 'en', system: 'en' }).lang, 'pt');
});

test('invalid values fall through to the next level; flag/env ones are reported', () => {
  const r = resolveLang({ flag: 'fr', env: 'pt', config: 'en' });
  assert.deepEqual([r.lang, r.source], ['pt', 'env']);
  assert.deepEqual(r.warnings, [{ source: 'flag', value: 'fr' }]);

  const r2 = resolveLang({ flag: 'zz', env: 'yy', config: 'en', system: 'pt' });
  assert.deepEqual([r2.lang, r2.source], ['en', 'config']);
  assert.deepEqual(r2.warnings.map((w) => w.source), ['flag', 'env']);

  const r3 = resolveLang({ config: 'klingon', system: 'pt-BR' });
  assert.deepEqual([r3.lang, r3.source, r3.warnings], ['pt', 'system', []], 'bad config: skipped silently');

  const r4 = resolveLang({ system: 'ja-JP' });
  assert.deepEqual([r4.lang, r4.source, r4.warnings], ['en', 'default', []], 'unsupported system locale -> en');
});

test('empty flag/env are treated as not set', () => {
  assert.equal(resolveLang({ flag: '', env: '', config: 'pt' }).source, 'config');
});

test('resolveForProcess reads NULLBRAND_LANG and config.json from the home dir', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nb-lang-'));
  try {
    const sys = 'en-US';
    assert.equal(resolveForProcess({ home, env: {}, system: sys }).lang, 'en');
    await saveLang(home, 'pt');
    assert.deepEqual(resolveForProcess({ home, env: {}, system: sys }).source, 'config');
    assert.equal(resolveForProcess({ home, env: { NULLBRAND_LANG: 'en' }, system: sys }).lang, 'en', 'env beats config');
    assert.equal(resolveForProcess({ flag: 'pt', home, env: { NULLBRAND_LANG: 'en' }, system: sys }).source, 'flag');
    const bad = resolveForProcess({ home, env: { NULLBRAND_LANG: 'fr' }, system: sys });
    assert.deepEqual([bad.lang, bad.source, bad.warnings.length], ['pt', 'config', 1]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('config.json: not created by reading; saving keeps other fields; broken file is set aside', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nb-cfg-'));
  try {
    assert.deepEqual(readConfig(home), {});
    resolveForProcess({ home, env: {}, system: 'pt-BR' }); // auto-detected language is never written
    await assert.rejects(stat(configPath(home)), { code: 'ENOENT' }, 'no file after a plain resolution');

    await writeFile(configPath(home), JSON.stringify({ theme: 'dark', lang: 'en', nested: { a: 1 } }));
    const saved = await saveLang(home, 'pt');
    assert.deepEqual(saved, { theme: 'dark', lang: 'pt', nested: { a: 1 } });
    assert.deepEqual(parseJson(await readFile(configPath(home), 'utf8')), saved);
    if (process.platform !== 'win32') assert.equal((await stat(configPath(home))).mode & 0o777, 0o600);

    await assert.rejects(saveLang(home, 'fr'), RangeError);

    await writeFile(configPath(home), '{ not json');
    assert.deepEqual(await saveLang(home, 'en'), { lang: 'en' });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
