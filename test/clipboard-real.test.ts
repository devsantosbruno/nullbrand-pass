import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipboard, detectBackend } from '../src/clipboard.js';

const enabled = process.env['NULLBRAND_REAL_CLIPBOARD'] === '1';
const skip = enabled ? false : 'set NULLBRAND_REAL_CLIPBOARD=1 to use the real system clipboard';
const SAMPLE = 'nb-real-clipboard-Zq7!ação';

test('real backend: write, read and clear', { skip }, async () => {
  const backend = await detectBackend();
  await backend.write(SAMPLE, { sensitive: true });
  assert.equal(await backend.read(), SAMPLE);
  await backend.clear();
  const after = await backend.read().catch(() => '');
  assert.equal(after, '');
});

test('real backend: createClipboard clears only what it copied', { skip }, async () => {
  const backend = await detectBackend();
  const clipboard = createClipboard({ backend, ttlMs: 60_000 });
  await clipboard.copy(SAMPLE);
  assert.equal(await backend.read(), SAMPLE);
  assert.equal(await clipboard.flush(), 'cleared');
  assert.equal(await backend.read().catch(() => ''), '');

  await clipboard.copy(SAMPLE);
  await backend.write('something else', { sensitive: false });
  assert.equal(await clipboard.flush(), 'changed');
  assert.equal(await backend.read(), 'something else');
  await backend.clear();
});
