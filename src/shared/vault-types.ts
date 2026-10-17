// The shape of a vault item, shared by the vault, the HTTP API and the web UI. Pure: no Node or DOM APIs.
// Items are stored FLAT: every item carries every field and the ones that do not belong to its type are the empty string
// (and `uris` is []). The union below says exactly that, so a login can never hold a card number, and `isVaultItem()` checks it.
import { isObjectLike, isStringArray } from './guards.js';

export const ITEM_TYPES = ['login', 'note', 'card', 'identity', 'ssh'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const LOGIN_KEYS = ['username', 'password', 'totp'] as const;
export const CARD_KEYS = ['cardholder', 'cardNumber', 'cardExpiry', 'cardCvv'] as const;
export const IDENTITY_KEYS = [
  'fullName', 'email', 'phone', 'birthDate', 'rg', 'cpf', 'pis', 'cnpj', 'cnh', 'passport', 'address', 'city', 'state', 'zip', 'country',
] as const;
export const SSH_KEYS = ['sshAlgo', 'sshTitle', 'sshPublicKey', 'sshFingerprint', 'sshPrivateKey', 'sshHost', 'sshUser', 'sshPort'] as const;

export type LoginKey = (typeof LOGIN_KEYS)[number];
export type CardKey = (typeof CARD_KEYS)[number];
export type IdentityKey = (typeof IDENTITY_KEYS)[number];
export type SshKey = (typeof SSH_KEYS)[number];

// Keys that do not belong to an item's type: always the empty string.
export type Empty<K extends string> = { [P in K]: '' };
type Filled<K extends string> = { [P in K]: string };

type ItemCommon = {
  id: string;
  name: string;
  notes: string;
  folder: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LoginItem = ItemCommon & { type: 'login'; uris: readonly string[] } & Filled<LoginKey> & Empty<CardKey | IdentityKey | SshKey>;
export type NoteItem = ItemCommon & { type: 'note'; uris: readonly [] } & Empty<LoginKey | CardKey | IdentityKey | SshKey>;
export type CardItem = ItemCommon & { type: 'card'; uris: readonly [] } & Filled<CardKey> & Empty<LoginKey | IdentityKey | SshKey>;
export type IdentityItem = ItemCommon & { type: 'identity'; uris: readonly [] } & Filled<IdentityKey> & Empty<LoginKey | CardKey | SshKey>;
export type SshItem = ItemCommon & { type: 'ssh'; uris: readonly [] } & Filled<SshKey> & Empty<LoginKey | CardKey | IdentityKey>;
export type VaultItem = LoginItem | NoteItem | CardItem | IdentityItem | SshItem;

// Exhaustiveness check for `switch (item.type)`: adding a type to the union makes every switch that forgets it a compile error.
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}

export function isItemType(value: unknown): value is ItemType {
  return ITEM_TYPES.some((type) => type === value);
}

// The keys an item of this type fills in (the other groups must be '').
export function ownedKeys(type: ItemType): readonly string[] {
  switch (type) {
    case 'login':
      return LOGIN_KEYS;
    case 'note':
      return [];
    case 'card':
      return CARD_KEYS;
    case 'identity':
      return IDENTITY_KEYS;
    case 'ssh':
      return SSH_KEYS;
    default:
      return assertNever(type);
  }
}

const ALL_TYPED_KEYS: readonly (readonly string[])[] = [LOGIN_KEYS, CARD_KEYS, IDENTITY_KEYS, SSH_KEYS];

// True only for an object that satisfies the VaultItem union (extra unknown properties are allowed, as they are kept on disk).
export function isVaultItem(value: unknown): value is VaultItem {
  if (!isObjectLike(value)) return false;
  const type = value['type'];
  if (!isItemType(type)) return false;
  for (const key of ['id', 'name', 'notes', 'folder', 'createdAt', 'updatedAt'] as const) {
    if (typeof value[key] !== 'string') return false;
  }
  if (value['id'] === '' || typeof value['favorite'] !== 'boolean') return false;
  const uris = value['uris'];
  if (!isStringArray(uris)) return false;
  if (type !== 'login' && uris.length > 0) return false;
  const owned = ownedKeys(type);
  for (const group of ALL_TYPED_KEYS) {
    for (const key of group) {
      const field = value[key];
      if (typeof field !== 'string') return false;
      if (!owned.includes(key) && field !== '') return false;
    }
  }
  return true;
}
