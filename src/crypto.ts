// Node built-ins only: scrypt (KDF) + AES-256-GCM (authenticated encryption).
import { coded } from './errors.js';
import { isObjectLike } from './shared/guards.js';
import { GCM_TAG_LEN, invalidBufferError, isDerivedKey, toAuthTag, toCiphertext, toNonce, toSalt, type DerivedKey, type MasterPassword, type Salt } from './brands.js';
import { scrypt, randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

/** KDF parameters as stored in the plain-text vault header. */
export interface KdfParams {
  readonly name: 'scrypt';
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLen: 32;
  readonly salt: string;
}

/** AES-256-GCM box as stored in the vault; every field is base64. */
export interface EncryptedBox {
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

/** Scrypt parameters for new vaults: N=2^17, r=8 (128 MiB of memory). */
export const DEFAULT_KDF = Object.freeze({ name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32 } as const);

/** Minimum accepted when writing. Weaker vaults still open but are migrated on unlock. */
export const MIN_KDF = Object.freeze({ N: 2 ** 17, r: 8, p: 1 } as const);
// Read ceiling, higher than the write minimum: the header is plain text, so a hostile file with a huge N could force GBs of
// allocation. N=2^20, r=16 is about 2 GiB; files written by nullbrand always use r=8.
const MAX_KDF = Object.freeze({ N: 2 ** 20, r: 16, p: 4 } as const);
const MIN_OPEN_N = 2 ** 10;

/** KDF identifiers the format knows. `argon2id` is reserved but not accepted for derivation (`crypto.argon2` is experimental, Node >= 24.7). */
export const KDF_IDS = Object.freeze(['scrypt', 'argon2id'] as const);

/**
 * Validates KDF parameters read from a vault header before any memory is spent on them.
 * @param kdf untrusted input straight from the file; narrowed to {@link KdfParams} on return.
 * @throws coded `err.vault.badHeader` when a field is missing or out of range.
 */
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

/** Non-throwing form of {@link validateKdf}. */
export function isKdfParams(kdf: unknown): kdf is KdfParams {
  try {
    validateKdf(kdf);
    return true;
  } catch {
    return false;
  }
}

/** Returns true when the parameters are below {@link MIN_KDF} or belong to another KDF. */
export function isWeakKdf(kdf: KdfParams): boolean {
  return kdf.name !== 'scrypt' || kdf.N < MIN_KDF.N || kdf.r < MIN_KDF.r || kdf.p < MIN_KDF.p;
}

/**
 * Returns the `maxmem` option scrypt needs: 128·r·(N + p + 2) bytes plus 8 MiB of headroom.
 * Node's 32 MiB default makes N=2^17 throw "memory limit exceeded".
 */
export function scryptMaxmem({ N, r, p }: Pick<KdfParams, 'N' | 'r' | 'p'>): number {
  return 128 * r * (N + p + 2) + 8 * 1024 * 1024;
}

/**
 * Derives the vault key on the libuv thread pool, so the ~0.5 s derivation does not block the event loop.
 * The password is NFKC-normalized, and the internal copy is zeroed once scrypt is done.
 * @throws coded `err.emptyPassword` for an empty password, or `err.vault.badHeader` for invalid parameters (as a rejection).
 */
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
  // A Buffer, so the copy can be zeroed (the original string is immutable).
  const pw = Buffer.from(password.normalize('NFKC'), 'utf8');
  return new Promise((resolve, reject) => {
    // scrypt() can throw synchronously on invalid parameters; the callback then never runs, so the copy is zeroed here.
    let started = false;
    try {
      scrypt(pw, salt, kdf.keyLen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: scryptMaxmem(kdf) }, (...args) => {
        pw.fill(0);
        const [err, key] = args;
        if (err) {
          reject(err);
          return;
        }
        // Nothing may throw in this async callback (it would crash the process): failures reject instead.
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

/** Returns the default scrypt parameters with a fresh random 16-byte salt. */
export function newKdfParams(): KdfParams {
  return { ...DEFAULT_KDF, salt: randomBytes(16).toString('base64') };
}

/**
 * Encrypts a JSON value with a fresh random nonce.
 * @param aad additional authenticated data; binds the ciphertext to the file header.
 */
export function encryptJson(key: DerivedKey, value: object, aad: string = ''): EncryptedBox {
  const iv = toNonce(randomBytes(12));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = toCiphertext(Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]));
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/**
 * Rejects a box whose tag is not 16 bytes.
 * Call it when a file is read, before the expensive key derivation.
 */
export function checkBoxTag(box: EncryptedBox): void {
  toAuthTag(Buffer.from(box.tag, 'base64'));
}

/**
 * Decrypts and parses a box. The result is `unknown` because a vault payload is an input boundary: narrow it with a guard.
 * @param aad must match the value given to {@link encryptJson}.
 * @throws {WrongPasswordError} when authentication fails (wrong key, wrong AAD or tampered data).
 * @throws coded `err.vault.corrupted` when the content is authentic but not valid JSON.
 */
export function decryptJson(key: DerivedKey, box: EncryptedBox, aad: string = ''): unknown {
  // The length check gives a clear error; authTagLength also makes OpenSSL refuse a truncated tag.
  const tag = toAuthTag(Buffer.from(box.tag, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'), { authTagLength: GCM_TAG_LEN });
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
  } catch {
    // Never compare the OpenSSL message or `code`: a stale queued error can make a later good decryption fail.
    throw new WrongPasswordError();
  }
  // Authentic but not JSON: the password was right and the content is damaged.
  try {
    const parsed: unknown = JSON.parse(plain.toString('utf8'));
    return parsed;
  } catch {
    throw coded('err.vault.corrupted', 'Corrupted vault: the decrypted content is not valid.');
  } finally {
    plain.fill(0);
  }
}

/** Thrown when GCM authentication fails. Deliberately does not tell a wrong password from a damaged file. */
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

/** Compares two secrets in constant time. Both sides are hashed first so their length does not leak. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (v: string): Buffer => createHash('sha256').update(String(v)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** Returns a URL-safe random token of `bytes` random bytes (default 32). */
export function randomToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('base64url');
}
