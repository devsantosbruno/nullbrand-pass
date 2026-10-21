import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8').replace(/\r\n/g, '\n');

test('release workflow pins every action to a full commit SHA', () => {
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const ref of uses) {
    assert.match(ref, /@[0-9a-f]{40}$/, `not pinned: ${ref}`);
  }
});

test('release workflow runs only on version tags and defaults to read-only', () => {
  assert.match(workflow, /on:\s+push:\s+tags: \['v\*'\]/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
});

test('release workflow never interpolates the tag into a shell script', () => {
  const runs = workflow.split(/^\s*run: /m).slice(1).map((chunk) => chunk.split(/^\s{6,8}\S+:/m)[0]);
  for (const run of runs) {
    assert.doesNotMatch(run, /\$\{\{\s*github\.(ref|ref_name|head_ref)\b/);
  }
});

/** The text of each job, keyed by its name. */
const jobs = Object.fromEntries(
  workflow
    .slice(workflow.indexOf('\njobs:\n'))
    .split(/^  (?=[a-z][a-z-]*:$)/m)
    .slice(1)
    .map((block) => [block.slice(0, block.indexOf(':')), block]),
);
const beforeSteps = (job) => job.slice(0, job.indexOf('    steps:'));

test('only the publish job may write, and it needs the signing permissions', () => {
  const { publish } = jobs;
  assert.ok(publish, 'publish job missing');
  for (const [name, job] of Object.entries(jobs)) {
    if (name === 'publish') continue;
    assert.doesNotMatch(job, /contents: write|attestations: write/, `${name} must not write`);
  }
  for (const permission of ['contents: write', 'id-token: write', 'attestations: write']) {
    assert.ok(publish.includes(permission), `publish lacks ${permission}`);
  }
});

test('only publish, publish-npm and the Windows signing job may request an OIDC token', () => {
  for (const [name, job] of Object.entries(jobs)) {
    if (['publish', 'publish-npm', 'package-windows'].includes(name)) continue;
    assert.doesNotMatch(job, /id-token: write/, `${name} must not request an OIDC token`);
  }
  assert.match(jobs['package-windows'], /id-token: write/);
  assert.match(jobs['publish-npm'], /id-token: write/);
});

test('npm is published last, from the checksummed tarball, with provenance and no stored token', () => {
  const job = jobs['publish-npm'];
  assert.match(job, /needs: publish$/m);
  assert.match(beforeSteps(job), /^    environment: npm$/m);
  assert.match(job, /sha256sum --check --ignore-missing SHA256SUMS/);
  assert.match(job, /npm publish --provenance --access public --tag "\$dist_tag" -- "nullbrand-pass-\$\{TAG#v\}\.tgz"/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
  assert.doesNotMatch(job, /contents: write/);
});

test('signing is explicit: the release-signing environment is used only when SIGN_RELEASES is true', () => {
  for (const name of ['package-macos', 'package-windows']) {
    const job = jobs[name];
    assert.match(
      beforeSteps(job),
      /^    environment: \$\{\{ vars\.SIGN_RELEASES == 'true' && 'release-signing' \|\| 'release-unsigned' \}\}$/m,
      `${name} lacks the environment switch`,
    );
    // every step that touches a credential, or verifies a signature, runs only when signing is on
    for (const step of job.split(/^      - /m).slice(1)) {
      if (/secrets\.|azure\/login|verify-signatures|package:release/.test(step)) {
        assert.match(step, /if: .*vars\.SIGN_RELEASES == 'true'/, `${name}: a signing step is not conditional:\n${step}`);
      }
    }
    assert.match(job, /name: Package \(unsigned\)\n\s+if: vars\.SIGN_RELEASES != 'true'/);
  }
});

test('every package job feeds the checksums', () => {
  assert.match(jobs.build, /needs: \[verify, package-linux, package-macos, package-windows\]/);
  assert.match(jobs.build, /pattern: installers-\*/);
});

test('secrets are read only by the steps that need them, never by a job or the workflow', () => {
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\njobs:\n')), /secrets\./);
  for (const [name, job] of Object.entries(jobs)) {
    assert.doesNotMatch(beforeSteps(job), /secrets\./, `${name} exposes a secret to every step`);
  }
  for (const [name, job] of Object.entries(jobs)) {
    assert.doesNotMatch(job, /run: .*\$\{\{\s*(secrets|vars)\./, `${name} puts a secret or variable into a shell command`);
    assert.doesNotMatch(job, /set -x|ACTIONS_STEP_DEBUG|DEBUG: /, `${name} could print secrets`);
  }
});

test('macOS and Windows installers are verified before they are uploaded', () => {
  for (const name of ['package-macos', 'package-windows']) {
    const verify = jobs[name].indexOf('scripts/verify-signatures.mjs');
    assert.ok(verify > 0, `${name} does not verify signatures`);
    assert.ok(verify < jobs[name].indexOf('actions/upload-artifact'), `${name} uploads before verifying`);
  }
});

test('the release build config refuses to produce unsigned binaries', () => {
  const config = readFileSync('desktop/builder.release.mjs', 'utf8');
  assert.match(config, /forceCodeSigning: true/);
  assert.match(config, /hardenedRuntime: true/);
  assert.match(config, /notarize: true/);
  assert.match(config, /timestampRfc3161/);
  assert.doesNotMatch(config, /identity: null|forceCodeSigning: false/);
  assert.match(readFileSync('desktop/package.json', 'utf8'), /"package:release": ".*--config builder\.release\.mjs --publish never"/);
});

test('the local build config stays unsigned, so a local build never picks up a certificate', () => {
  const config = readFileSync('desktop/builder.yml', 'utf8');
  assert.match(config, /^  identity: null$/m);
});
