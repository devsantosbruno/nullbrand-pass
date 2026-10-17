import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// Repo-relative paths named in backticks in the README must exist (source files only; dist/ is build output).
test('README only names files that exist', () => {
  const readme = readFileSync('README.md', 'utf8');
  const paths = [...readme.matchAll(/`((?:src|locales|static|scripts|docs|test|bin)\/[\w./-]+\.\w+)`/g)].map((m) => m[1]);
  assert.ok(paths.length > 0);
  for (const p of new Set(paths)) {
    assert.ok(existsSync(p), `README mentions missing path: ${p}`);
  }
});
