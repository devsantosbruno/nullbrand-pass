// The shapes every importer produces and every adapter implements. Nothing here knows a product name: a layout is an adapter.
import type { ApiWarning } from '../shared/api.js';
import type { CardKey, IdentityKey, SshKey } from '../shared/vault-types.js';

/** A lossy or surprising step, translatable by `key` and `params`. */
export type FormatWarning = ApiWarning;

type Common = {
  name: string;
  folder: string;
  favorite: boolean;
  createdAt: string | undefined;
  notes: string;
};
type Filled<K extends string> = { [P in K]: string };

/** An item in a neutral shape. `Vault.merge` normalizes it into a VaultItem, so an adapter only reports what it found. */
export type InterchangeItem =
  | (Common & { type: 'login'; username: string; password: string; totp: string; uris: string[] })
  | (Common & { type: 'note' })
  | (Common & { type: 'card' } & Filled<CardKey>)
  | (Common & { type: 'identity' } & Filled<IdentityKey>)
  | (Common & { type: 'ssh' } & Filled<SshKey>);

/** What an adapter read from a document. */
export interface ParseResult {
  items: InterchangeItem[];
  /** Entries recognized but not representable (deleted, unsupported type). */
  ignored: number;
  warnings: FormatWarning[];
}

/** A JSON layout. `document` is the parsed file, of unknown shape. */
export interface ImportAdapter {
  /** Internal identifier; never shown to the user. */
  readonly id: string;
  /** Scores how likely the document is this layout: 0 = not it, 1 = certain. Cheap and free of side effects. */
  detect(document: unknown): number;
  /** Reads the document. @throws coded `err.import.*` on an invalid entry. */
  parse(document: unknown): ParseResult;
}
