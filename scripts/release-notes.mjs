// Release guard, plain Node.
//   node scripts/release-notes.mjs vX.Y.Z   checks the tag and prints that version's CHANGELOG section to stdout
//
// Exits 1 unless the tag is a plain semver tag, equals `v` + the version in package.json, and CHANGELOG.md has a
// non-empty `## [X.Y.Z]` section for it. The release workflow runs this before building anything.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Returns the version in a `vX.Y.Z[-pre]` tag, or throws if the tag is not strict semver. */
export function versionFromTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v') || !SEMVER.test(tag.slice(1))) {
    throw new Error(`tag "${String(tag)}" is not of the form vX.Y.Z`);
  }
  return tag.slice(1);
}

/** Returns the body of the `## [version]` section of a Keep a Changelog file, or throws if it is missing or empty. */
export function sectionFor(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = (line) => /^## \[/.test(line);
  const start = lines.findIndex((line) => heading(line) && line.startsWith(`## [${version}]`));
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const end = lines.findIndex((line, i) => i > start && heading(line));
  const body = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
  if (body === '') throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return body;
}

/** Validates `tag` against the package version and the changelog, and returns the release notes. */
export function releaseNotes(tag, packageVersion, changelog) {
  const version = versionFromTag(tag);
  if (version !== packageVersion) {
    throw new Error(`tag ${tag} does not match package.json version ${packageVersion}`);
  }
  return sectionFor(changelog, version);
}

function main() {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8');
  try {
    process.stdout.write(`${releaseNotes(process.argv[2], pkg.version, changelog)}\n`);
  } catch (err) {
    process.stderr.write(`release-notes: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
