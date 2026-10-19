import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey } from '../src/crypto.js';
import type { KdfParams } from '../src/crypto.js';
import { toMasterPassword } from '../src/brands.js';

const SALT = Buffer.alloc(16, 7).toString('base64');
const PASSWORD = 'zeroing-test-password-31-bytes';

async function zeroedLengths(fn: () => Promise<unknown>): Promise<{ lengths: number[]; outcome: unknown }> {
  const lengths: number[] = [];
  const original = Buffer.prototype.fill;
  Buffer.prototype.fill = function (this: Buffer, ...args: Parameters<Buffer['fill']>) {
    if (args[0] === 0) lengths.push(this.length);
    return original.apply(this, args);
  };
  try {
    const outcome = await fn().then(
      () => 'resolved',
      (err: unknown) => err,
    );
    return { lengths, outcome };
  } finally {
    Buffer.prototype.fill = original;
  }
}

test('the password copy is zeroed when scrypt() throws synchronously, and the promise rejects with that error', async () => {
  let reads = 0;
  const kdf: KdfParams = {
    name: 'scrypt',
    get N() {
      reads += 1;
      return reads === 1 ? 2 ** 10 : 3;
    },
    r: 8,
    p: 1,
    keyLen: 32,
    salt: SALT,
  };
  const { lengths, outcome } = await zeroedLengths(() => deriveKey(toMasterPassword(PASSWORD), kdf));
  assert.ok(reads >= 2, 'the N getter must have been read by scrypt() too');
  assert.ok(outcome instanceof Error, 'rejects');
  assert.equal(Reflect.get(outcome, 'code'), 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS');
  assert.equal(lengths.filter((n) => n === PASSWORD.length).length, 1, 'the password copy was zeroed exactly once');
});

test('the normal path still zeroes the password copy exactly once', async () => {
  const kdf: KdfParams = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32, salt: SALT };
  const { lengths, outcome } = await zeroedLengths(() => deriveKey(toMasterPassword(PASSWORD), kdf));
  assert.equal(outcome, 'resolved');
  assert.equal(lengths.filter((n) => n === PASSWORD.length).length, 1);
});
