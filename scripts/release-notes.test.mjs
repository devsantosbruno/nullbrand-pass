import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { releaseNotes, sectionFor, versionFromTag } from './release-notes.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

### Added
- Next thing.

## [0.2.0] - 2026-11-01

### Fixed
- A bug.

## [0.1.0]

First version.
`;

test('versionFromTag accepts strict semver tags only', () => {
  assert.equal(versionFromTag('v0.2.0'), '0.2.0');
  assert.equal(versionFromTag('v1.0.0-rc.1'), '1.0.0-rc.1');
  for (const bad of ['0.2.0', 'v0.2', 'v01.2.3', 'v1.2.3+build', 'v1.2.3 ', 'v1.2.3\n', 'vx', 'v', '', 'refs/tags/v1.2.3', undefined]) {
    assert.throws(() => versionFromTag(bad), /not of the form/, String(bad));
  }
});

test('sectionFor returns one section, with or without a date', () => {
  assert.equal(sectionFor(CHANGELOG, '0.2.0'), '### Fixed\n- A bug.');
  assert.equal(sectionFor(CHANGELOG, '0.1.0'), 'First version.');
});

test('sectionFor refuses a missing or empty section', () => {
  assert.throws(() => sectionFor(CHANGELOG, '9.9.9'), /no section for 9\.9\.9/);
  assert.throws(() => sectionFor('## [1.0.0]\n\n## [0.9.0]\nx\n', '1.0.0'), /empty/);
  assert.throws(() => sectionFor(CHANGELOG, '0.2'), /no section/);
});

test('releaseNotes requires the tag to match the package version', () => {
  assert.equal(releaseNotes('v0.2.0', '0.2.0', CHANGELOG), '### Fixed\n- A bug.');
  assert.throws(() => releaseNotes('v0.2.1', '0.2.0', CHANGELOG), /does not match/);
});

test('the version in package.json has a CHANGELOG section', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  assert.ok(sectionFor(changelog, pkg.version).length > 0);
});
