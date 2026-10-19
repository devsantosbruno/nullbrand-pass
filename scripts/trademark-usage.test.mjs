import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Bitwarden may be named only to describe the import format: no positioning wording, no logos.
test('package.json does not position the project as Bitwarden-like', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.doesNotMatch(pkg.description, /bitwarden/i);
  assert.ok(!pkg.keywords.some((k) => /bitwarden/i.test(k)), 'keywords must not include Bitwarden');
});

test('README does not call the project Bitwarden-style and keeps the disclaimer', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.doesNotMatch(readme, /bitwarden[- ]style/i);
  assert.match(readme, /Not affiliated with or endorsed by Bitwarden/);
});

test('no Bitwarden logo or brand asset ships in static/', () => {
  const offenders = readdirSync('static').filter((f) => /bitwarden|bw[-_.]/i.test(f));
  assert.deepEqual(offenders, []);
});
