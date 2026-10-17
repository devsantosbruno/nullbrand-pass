// Branded types for sensitive values. A brand is a phantom property: it exists only for the compiler, so a `DerivedKey` IS the
// very same Buffer at runtime (no copy, no conversion: `key.fill(0)` still zeroes the original). Since `as` is forbidden, every brand is
// created by a constructor that checks the value and narrows it through a hand-written type guard.
// Only checks that are ALWAYS true for the values the code produces are enforced, so none of them can change what the program does.
import { coded } from './errors.js';

export type MasterPassword = string & { readonly __brand: 'MasterPassword' };
export type Salt = Buffer & { readonly __brand: 'Salt' };
export type Nonce = Buffer & { readonly __brand: 'Nonce' };
export type Ciphertext = Buffer & { readonly __brand: 'Ciphertext' };
export type DerivedKey = Buffer & { readonly __brand: 'DerivedKey' };
export type AuthTag = Buffer & { readonly __brand: 'AuthTag' };

// AES-256-GCM / scrypt sizes (bytes).
export const KEY_BYTES = 32;
export const MIN_SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const GCM_TAG_LEN = 16;

// The typed error every constructor throws. Exported so that code running inside an ASYNC callback (where a throw would crash the
// process instead of rejecting the promise) can pass the very same error to reject() instead.
export const invalidBufferError = (what: string) => coded('err.crypto.invalidBuffer', `Internal error: invalid ${what}.`, { what });

// Same test deriveKey always did: JS callers may still hand over a non-string, which must keep meaning "empty password".
export function isMasterPassword(value: string): value is MasterPassword {
  return typeof value === 'string' && value.length > 0;
}
export function toMasterPassword(value: string): MasterPassword {
  if (!isMasterPassword(value)) throw coded('err.emptyPassword', 'Empty master password.');
  return value;
}

export function isSalt(value: Buffer): value is Salt {
  return value.length >= MIN_SALT_BYTES;
}
export function toSalt(value: Buffer): Salt {
  if (!isSalt(value)) throw invalidBufferError('salt');
  return value;
}

export function isNonce(value: Buffer): value is Nonce {
  return value.length === NONCE_BYTES;
}
export function toNonce(value: Buffer): Nonce {
  if (!isNonce(value)) throw invalidBufferError('nonce');
  return value;
}

export function isCiphertext(value: Buffer): value is Ciphertext {
  return value.length > 0;
}
export function toCiphertext(value: Buffer): Ciphertext {
  if (!isCiphertext(value)) throw invalidBufferError('ciphertext');
  return value;
}

export function isDerivedKey(value: Buffer): value is DerivedKey {
  return value.length === KEY_BYTES;
}
export function toDerivedKey(value: Buffer): DerivedKey {
  if (!isDerivedKey(value)) throw invalidBufferError('derived key');
  return value;
}

// A GCM tag shorter than 16 bytes weakens the integrity check (Node 22.14 accepts a truncated tag unless told otherwise), so only the
// full length is accepted. Unlike the other constructors this one validates FILE content, so it throws the vault's own error.
export function isAuthTag(value: Buffer): value is AuthTag {
  return value.length === GCM_TAG_LEN;
}
export function toAuthTag(value: Buffer): AuthTag {
  if (!isAuthTag(value)) throw coded('err.vault.corrupted', 'Corrupted vault (invalid authentication tag).');
  return value;
}
