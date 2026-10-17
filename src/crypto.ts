// Cryptographic primitives for nullbrand.
// Node built-in modules only: scrypt (KDF) + AES-256-GCM (authenticated encryption).
import { coded } from './errors.js';
import { isObjectLike } from './shared/guards.js';
import { GCM_TAG_LEN, invalidBufferError, isDerivedKey, toAuthTag, toCiphertext, toNonce, toSalt, type DerivedKey, type MasterPassword, type Salt } from './brands.js';
import { scrypt, randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

// KDF parameters as stored in the (plain-text) vault header.
export interface KdfParams {
  readonly name: 'scrypt';
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLen: 32;
  readonly salt: string; // base64
}

// AES-256-GCM box as stored in the vault: every field is base64.
export interface EncryptedBox {
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

// Default scrypt parameters: N=2^17, r=8 → 128 MiB of memory (128·N·r bytes).
export const DEFAULT_KDF = Object.freeze({ name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32 } as const);

// Minimum accepted when WRITING; vaults below it still open, but are migrated (see vault.js).
export const MIN_KDF = Object.freeze({ N: 2 ** 17, r: 8, p: 1 } as const);
// Maximum accepted when READING: the header is plain text, and a malicious file with a huge N
// would make Node allocate GBs. The ceiling (N=2^20, r=16) is about 2 GiB of memory; files written by nullbrand always use r=8.
const MAX_KDF = Object.freeze({ N: 2 ** 20, r: 16, p: 4 } as const);
const MIN_OPEN_N = 2 ** 10;

// Known KDF identifiers. 'argon2id' is reserved in the format (crypto.argon2 only exists on
// Node >= 24.7 and is still experimental), but is NOT accepted for deriving keys for now.
export const KDF_IDS = Object.freeze(['scrypt', 'argon2id'] as const);

// Validates the parameters read from the header before spending memory on them.
// `kdf` is `unknown`: it comes straight from the vault file. On return it IS a KdfParams.
export function validateKdf(kdf: unknown): asserts kdf is KdfParams {
  function bad(why: string): never {
    throw coded('err.vault.badHeader', `Invalid vault header (KDF: ${why}).`, { why });
  }
  if (!isObjectLike(kdf)) bad('missing');
  const name = kdf['name'];
  if (!KDF_IDS.some((id) => id === name)) bad(`unknown "${String(name).slice(0, 20)}"`);
  if (name !== 'scrypt') bad(`${String(name)} is not supported yet`);
  const N = kdf['N'];
  const r = kdf['r'];
  const p = kdf['p'];
  const keyLen = kdf['keyLen'];
  if (typeof N !== 'number' || !Number.isInteger(N) || N < MIN_OPEN_N || N > MAX_KDF.N || (N & (N - 1)) !== 0) bad('N');
  if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > MAX_KDF.r) bad('r');
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > MAX_KDF.p) bad('p');
  if (keyLen !== 32) bad('keyLen');
  const salt = kdf['salt'];
  if (typeof salt !== 'string' || Buffer.from(salt, 'base64').length < 16) bad('salt');
}

// validateKdf() as a yes/no question.
export function isKdfParams(kdf: unknown): kdf is KdfParams {
  try {
    validateKdf(kdf);
    return true;
  } catch {
    return false;
  }
}

// true if the parameters are below the current minimum (or belong to another KDF).
export function isWeakKdf(kdf: KdfParams): boolean {
  return kdf.name !== 'scrypt' || kdf.N < MIN_KDF.N || kdf.r < MIN_KDF.r || kdf.p < MIN_KDF.p;
}

// Memory required by scrypt (OpenSSL: 128·r·(N + p + 2)) + 8 MiB of headroom.
// Node's default (32 MiB) would make N=2^17 throw "memory limit exceeded".
export function scryptMaxmem({ N, r, p }: Pick<KdfParams, 'N' | 'r' | 'p'>): number {
  return 128 * r * (N + p + 2) + 8 * 1024 * 1024;
}

// Asynchronous (libuv thread pool): does not block the event loop during the ~0.5 s derivation.
export function deriveKey(password: MasterPassword, kdf: KdfParams): Promise<DerivedKey> {
  if (typeof password !== 'string' || password.length === 0) {
    return Promise.reject(coded('err.emptyPassword', 'Empty master password.'));
  }
  let salt: Salt;
  try {
    validateKdf(kdf);
    salt = toSalt(Buffer.from(kdf.salt, 'base64'));
  } catch (err) {
    return Promise.reject(err);
  }
  // A Buffer so the password copy can be zeroed afterwards (the original string is immutable).
  const pw = Buffer.from(password.normalize('NFKC'), 'utf8');
  return new Promise((resolve, reject) => {
    // scrypt() can also throw synchronously (invalid parameters): then the callback never runs, so the copy is zeroed here. The throw
    // itself still propagates out of the executor and rejects the promise, exactly as before.
    let started = false;
    try {
      scrypt(pw, salt, kdf.keyLen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: scryptMaxmem(kdf) }, (...args) => {
        pw.fill(0);
        const [err, key] = args;
        if (err) {
          reject(err);
          return;
        }
        // Inside this asynchronous callback nothing may throw (it would crash the process): a failed check rejects the promise.
        if (!isDerivedKey(key)) {
          reject(invalidBufferError('derived key'));
          return;
        }
        resolve(key);
      });
      started = true;
    } finally {
      if (!started) pw.fill(0);
    }
  });
}

export function newKdfParams(): KdfParams {
  return { ...DEFAULT_KDF, salt: randomBytes(16).toString('base64') };
}

// Encrypts a JSON value. "aad" binds the ciphertext to the file header.
export function encryptJson(key: DerivedKey, value: object, aad: string = ''): EncryptedBox {
  const iv = toNonce(randomBytes(12));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = toCiphertext(Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]));
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

// Rejects a box whose tag is not 16 bytes. Called when a file is read, before the (expensive) key derivation.
export function checkBoxTag(box: EncryptedBox): void {
  toAuthTag(Buffer.from(box.tag, 'base64'));
}

// Returns the decrypted JSON document as `unknown`: the payload of a vault file is an input boundary, and every caller narrows it
// right away with its own hand-written guard (see vault.ts).
export function decryptJson(key: DerivedKey, box: EncryptedBox, aad: string = ''): unknown {
  // Two layers: the length check gives a clear error, and authTagLength makes OpenSSL itself refuse a truncated tag.
  const tag = toAuthTag(Buffer.from(box.tag, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'), { authTagLength: GCM_TAG_LEN });
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
  } catch {
    // Any throw from update()/final() means "not authentic". Never compare the message or `code`: OpenSSL may leave a stale
    // error queued from an earlier failure, and a later good decryption must still succeed (see test/gcm-tag.test.ts).
    throw new WrongPasswordError();
  }
  // Authentic but not JSON: the password was right, the content is damaged. Not "wrong password".
  try {
    const parsed: unknown = JSON.parse(plain.toString('utf8'));
    return parsed;
  } catch {
    throw coded('err.vault.corrupted', 'Corrupted vault: the decrypted content is not valid.');
  } finally {
    plain.fill(0);
  }
}

export class WrongPasswordError extends Error {
  declare readonly code: 'WRONG_PASSWORD';
  declare readonly key: 'err.wrongPassword';
  declare readonly params: Readonly<Record<string, never>>;
  constructor() {
    super('Incorrect master password or corrupted vault.');
    this.code = 'WRONG_PASSWORD';
    this.key = 'err.wrongPassword';
    this.params = {};
  }
}

// Constant-time comparison. Both sides go through SHA-256 so they have equal length,
// so not even the secret's length leaks through response time.
export function safeEqual(a: string, b: string): boolean {
  const digest = (v: string): Buffer => createHash('sha256').update(String(v)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function randomToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('base64url');
}
