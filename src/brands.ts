// Branded types for sensitive values. A brand exists only for the compiler: a `DerivedKey` is the same Buffer at runtime, so
// `key.fill(0)` still zeroes the original. Since `as` is forbidden, each brand comes from a constructor that checks the value
// through a hand-written type guard. Only checks that always hold for values the code produces are enforced.
import { coded } from './errors.js';

/** The part of Node's `Buffer` the brands rely on. It keeps the public declarations free of `Buffer`, so consumers need no `@types/node`; a real `Buffer` satisfies it. */
interface Bytes extends Uint8Array<ArrayBuffer> {
  toString(encoding?: 'base64'): string;
}

export type MasterPassword = string & { readonly __brand: 'MasterPassword' };
export type Salt = Bytes & { readonly __brand: 'Salt' };
export type Nonce = Bytes & { readonly __brand: 'Nonce' };
export type Ciphertext = Bytes & { readonly __brand: 'Ciphertext' };
export type DerivedKey = Bytes & { readonly __brand: 'DerivedKey' };
export type AuthTag = Bytes & { readonly __brand: 'AuthTag' };

// AES-256-GCM and scrypt sizes, in bytes.
export const KEY_BYTES = 32;
export const MIN_SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const GCM_TAG_LEN = 16;

/** Builds the error every `to*` constructor throws. Exported so async callbacks, where a throw would crash the process, can pass it to `reject()`. */
export const invalidBufferError = (what: string) => coded('err.crypto.invalidBuffer', `Internal error: invalid ${what}.`, { what });

/** Narrows to a non-empty string. The `typeof` check stays because JS callers can pass a non-string, which means "empty". */
export function isMasterPassword(value: string): value is MasterPassword {
  return typeof value === 'string' && value.length > 0;
}
/** Brands a master password. @throws coded `err.emptyPassword` if empty. */
export function toMasterPassword(value: string): MasterPassword {
  if (!isMasterPassword(value)) throw coded('err.emptyPassword', 'Empty master password.');
  return value;
}

/** Narrows to a salt of at least 16 bytes. */
export function isSalt(value: Bytes): value is Salt {
  return value.length >= MIN_SALT_BYTES;
}
/** Brands a salt. @throws coded `err.crypto.invalidBuffer` if too short. */
export function toSalt(value: Bytes): Salt {
  if (!isSalt(value)) throw invalidBufferError('salt');
  return value;
}

/** Narrows to a 12-byte GCM nonce. */
export function isNonce(value: Bytes): value is Nonce {
  return value.length === NONCE_BYTES;
}
/** Brands a nonce. @throws coded `err.crypto.invalidBuffer` if not 12 bytes. */
export function toNonce(value: Bytes): Nonce {
  if (!isNonce(value)) throw invalidBufferError('nonce');
  return value;
}

/** Narrows to a non-empty ciphertext. */
export function isCiphertext(value: Bytes): value is Ciphertext {
  return value.length > 0;
}
/** Brands a ciphertext. @throws coded `err.crypto.invalidBuffer` if empty. */
export function toCiphertext(value: Bytes): Ciphertext {
  if (!isCiphertext(value)) throw invalidBufferError('ciphertext');
  return value;
}

/** Narrows to a 32-byte key. */
export function isDerivedKey(value: Bytes): value is DerivedKey {
  return value.length === KEY_BYTES;
}
/** Brands a derived key. @throws coded `err.crypto.invalidBuffer` if not 32 bytes. */
export function toDerivedKey(value: Bytes): DerivedKey {
  if (!isDerivedKey(value)) throw invalidBufferError('derived key');
  return value;
}

/** Narrows to a full 16-byte GCM tag; a shorter one weakens integrity (Node 22.14 accepts a truncated tag unless told otherwise). */
export function isAuthTag(value: Bytes): value is AuthTag {
  return value.length === GCM_TAG_LEN;
}
/** Brands an auth tag. Validates file content, so unlike the other constructors it throws the vault's `err.vault.corrupted`. */
export function toAuthTag(value: Bytes): AuthTag {
  if (!isAuthTag(value)) throw coded('err.vault.corrupted', 'Corrupted vault (invalid authentication tag).');
  return value;
}
