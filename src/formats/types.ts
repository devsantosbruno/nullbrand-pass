// The shapes every importer produces and every adapter implements. Nothing here knows a product name: a layout is just an adapter.
import type { ApiWarning } from '../shared/api.js';
import type { CardKey, IdentityKey, SshKey } from '../shared/vault-types.js';

export type FormatWarning = ApiWarning;

type Common = {
  name: string;
  folder: string;
  favorite: boolean;
  createdAt: string | undefined;
  notes: string;
};
type Filled<K extends string> = { [P in K]: string };

// One item in a neutral shape. `Vault.merge` normalises it into a VaultItem, so an adapter only has to say what it found.
export type InterchangeItem =
  | (Common & { type: 'login'; username: string; password: string; totp: string; uris: string[] })
  | (Common & { type: 'note' })
  | (Common & { type: 'card' } & Filled<CardKey>)
  | (Common & { type: 'identity' } & Filled<IdentityKey>)
  | (Common & { type: 'ssh' } & Filled<SshKey>);

export interface ParseResult {
  items: InterchangeItem[];
  // Entries that were recognised but cannot be represented (deleted, unsupported type).
  ignored: number;
  warnings: FormatWarning[];
}

// A JSON layout. `document` is the parsed file, of unknown shape.
export interface ImportAdapter {
  // Internal. Never shown to the user.
  readonly id: string;
  // Cheap and free of side effects. 0 = not this layout, 1 = certain.
  detect(document: unknown): number;
  parse(document: unknown): ParseResult;
}
