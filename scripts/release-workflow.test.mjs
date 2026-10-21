import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

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

test('only the publish job may write, and it needs the signing permissions', () => {
  const [head, publish] = workflow.split(/^  publish:$/m);
  assert.ok(publish, 'publish job missing');
  assert.doesNotMatch(head, /contents: write|id-token: write|attestations: write/);
  for (const permission of ['contents: write', 'id-token: write', 'attestations: write']) {
    assert.ok(publish.includes(permission), `publish lacks ${permission}`);
  }
});
