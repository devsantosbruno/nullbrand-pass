import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// No third-party product is named: import is by file structure, and the project never positions itself against another product.
// The pattern is built from pieces so this file does not contain the names it forbids.
const NAMES = new RegExp(['bit' + 'warden', 'pass' + 'bolt', 'kee' + 'pass', '1pass' + 'word', 'last' + 'pass', 'dash' + 'lane'].join('|'), 'i');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('no third-party product name in the sources, locales, static files, tests or docs', () => {
  const places = [...files('src'), ...files('locales'), ...files('static'), ...files('test').filter((f) => /\.ts$/.test(f)), 'README.md', 'package.json', 'CHANGELOG.md', 'TRADEMARKS.md'];
  const offenders = places.filter((file) => NAMES.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('no brand asset ships in static/', () => {
  const offenders = readdirSync('static').filter((f) => NAMES.test(f) || /^bw[-_.]/i.test(f));
  assert.deepEqual(offenders, []);
});
