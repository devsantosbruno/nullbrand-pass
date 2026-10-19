// Vault file: a single JSON with a plain-text header (version, KDF)
// and the content (items) encrypted with AES-256-GCM. Nothing leaves this machine.
import { promises as fs, existsSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { coded } from './errors.js';
import { toMasterPassword, type DerivedKey } from './brands.js';
import { deriveKey, newKdfParams, encryptJson, decryptJson, checkBoxTag, validateKdf, isWeakKdf, isKdfParams, type EncryptedBox, type KdfParams } from './crypto.js';
import { isObjectLike, isStringArray, isUnknownArray, spreadOf } from './shared/guards.js';
import {
  CARD_KEYS,
  IDENTITY_KEYS,
  FOLDER_MAX,
  LOGIN_KEYS,
  SSH_KEYS,
  isItemType,
  isVaultItem,
  type IdentityKey,
  type ItemType,
  type SshKey,
  type VaultItem,
} from './shared/vault-types.js';

export const FORMAT = 'nullbrand-vault';
// v1: AAD = JSON.stringify(kdf) (depended on key order) and no KDF minimum.
// v2: canonical AAD and validated KDF fields; v1 vaults or vaults with a KDF below the minimum are migrated.
// The container is still JSON (the header was already versioned and authenticated), so the
// KDF can become 'argon2id' in the future without changing the layout: just kdf.name and new parameters.
export const VERSION = 2;

// The plain-text part of the vault file.
export interface VaultHeader {
  format: string;
  version: number;
  kdf: KdfParams;
}
// What readVaultFile() returns: the header plus the encrypted payload.
export interface VaultFile extends VaultHeader {
  payload: EncryptedBox;
}

export function defaultHome(): string {
  if (process.env.NULLBRAND_HOME) return process.env.NULLBRAND_HOME;
  return join(homedir(), '.nullbrand');
}

export function defaultVaultPath(): string {
  return join(defaultHome(), 'vault.json');
}

// AES-GCM additional authenticated data (AAD): changing the version or any KDF parameter invalidates the vault.
// (IV and tag are already verified by GCM itself.)
function headerAad(header: VaultHeader): string {
  const { kdf } = header;
  if (header.version === 1) return `${header.format}:${header.version}:${JSON.stringify(kdf)}`;
  return [header.format, header.version, kdf.name, kdf.N, kdf.r, kdf.p, kdf.keyLen, kdf.salt].join(':');
}

// POSIX permissions (0700/0600) don't exist on Windows: there Node ignores `mode` and isolation
// comes from the ACLs inherited from the user profile (%USERPROFILE%). Nothing to do on that platform.
const IS_WIN = process.platform === 'win32';

export async function fsyncDir(dir: string): Promise<void> {
  if (IS_WIN) return; // directories cannot be opened on Windows
  let fh: FileHandle | undefined;
  try {
    fh = await fs.open(dir, 'r');
    await fh.sync();
  } catch {
    // some file systems don't support fsync on a directory; the data itself was already synced
  } finally {
    await fh?.close().catch(() => {});
  }
}

// Writes to a temporary file (same directory, 0600 on creation, independent of umask), fsyncs,
// renames over the original and fsyncs the directory. If anything fails, the original stays intact.
async function writeAtomic(path: string, data: string | Uint8Array, { exclusive = false }: { exclusive?: boolean } = {}): Promise<void> {
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let fh: FileHandle | null | undefined;
  try {
    fh = await fs.open(tmp, 'wx', 0o600);
    await fh.writeFile(data);
    await fh.sync();
    await fh.close();
    fh = null;
    if (exclusive && existsSync(path)) throw new Error(`${path} already exists`);
    await fs.rename(tmp, path);
  } catch (err) {
    await fh?.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  await fsyncDir(dir);
}

// Backup copy of the current file before rewriting it in another format.
export async function backupVaultFile(path: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const dest = `${path}.bak-${stamp}`;
  await writeAtomic(dest, await fs.readFile(path), { exclusive: true });
  return dest;
}

type LabelKey = 'folder' | 'vault' | 'backup';
const LABELS: Readonly<Record<LabelKey, string>> = { folder: 'Folder', vault: 'Vault', backup: 'Backup' };
const OWNED_DIRS: readonly string[] = ['.nullbrand'];

// One permission fix, in the form the callers can translate (see `detailed` below).
export interface PermissionMessage {
  key: string;
  params: { target: string; from: string; to: string };
  text: string;
}
export interface HardenOptions {
  uid?: number | undefined;
  detailed?: boolean;
}

// On startup (with or without a vault): if the data directory, the vault or its local backups are more
// open than 0700/0600, fixes them and returns short messages for the terminal. The directory is only
// changed if it is nullbrand's data directory (never the cwd of someone who used --vault ./vault.json).
// If the data directory or the vault belong to ANOTHER user (e.g. NULLBRAND_HOME pointing to a
// shared folder someone created earlier), refuses to use them: the other owner could swap
// the file or read it. `uid` is injectable for testing.
// With `detailed`, returns [{ key, params, text }] so the caller can translate; otherwise plain strings.
function isMissing(err: unknown): boolean {
  return isObjectLike(err) && err['code'] === 'ENOENT';
}

export async function hardenPermissions(path?: string, options?: HardenOptions & { detailed?: false }): Promise<string[]>;
export async function hardenPermissions(path: string | undefined, options: HardenOptions & { detailed: true }): Promise<PermissionMessage[]>;
export async function hardenPermissions(path?: string, options?: HardenOptions): Promise<(string | PermissionMessage)[]>;
export async function hardenPermissions(
  path: string = defaultVaultPath(),
  { uid = process.getuid?.(), detailed = false }: HardenOptions = {},
): Promise<(string | PermissionMessage)[]> {
  if (IS_WIN) return [];
  const messages: (string | PermissionMessage)[] = [];
  const check = async (target: string, want: number, labelKey: LabelKey, { chmod = true }: { chmod?: boolean } = {}): Promise<void> => {
    const label = LABELS[labelKey];
    let st;
    try {
      st = await fs.stat(target);
    } catch (err) {
      if (isMissing(err)) return;
      throw err;
    }
    if (uid !== undefined && st.uid !== uid) throw coded('err.vault.foreignOwner', `${label} ${target} belongs to another user; refusing to use it. Use another folder (NULLBRAND_HOME or --vault).`, { target });
    if (!chmod || !(st.mode & 0o077)) return;
    await fs.chmod(target, want);
    const from = (st.mode & 0o777).toString(8);
    const to = want.toString(8).padStart(4, '0');
    const text = `${label} ${target} had permission ${from}; fixed to ${to}.`;
    messages.push(detailed ? { key: `warn.permFixed.${labelKey}`, params: { target, from, to }, text } : text);
  };
  const dir = dirname(path);
  const home = process.env.NULLBRAND_HOME;
  const ownedDir = OWNED_DIRS.includes(basename(dir)) || (home && resolve(dir) === resolve(home));
  await check(dir, 0o700, 'folder', { chmod: Boolean(ownedDir) });
  await check(path, 0o600, 'vault');
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  for (const n of names) {
    if (n.startsWith(`${basename(path)}.bak-`)) await check(join(dir, n), 0o600, 'backup');
  }
  return messages;
}

function isEncryptedBox(value: unknown): value is EncryptedBox {
  return isObjectLike(value) && ['iv', 'tag', 'data'].every((k) => typeof value[k] === 'string');
}

// Final check of a parsed vault file whose parts were validated one by one in readVaultFile().
function isVaultFile(value: unknown): value is VaultFile {
  if (!isObjectLike(value)) return false;
  const { format, version, kdf, payload } = value;
  return typeof format === 'string' && typeof version === 'number' && isKdfParams(kdf) && isEncryptedBox(payload);
}

export async function readVaultFile(path: string): Promise<VaultFile> {
  const raw: unknown = JSON.parse(await fs.readFile(path, 'utf8'));
  // A non-object (null included) is not a vault file; null used to surface as a TypeError.
  if (!isObjectLike(raw)) throw coded('err.vault.notVault', 'This file is not a nullbrand vault.');
  if (raw['format'] !== FORMAT) throw coded('err.vault.notVault', 'This file is not a nullbrand vault.');
  const version = raw['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw coded('err.vault.invalidVersion', 'Invalid vault version.');
  if (version > VERSION) throw coded('err.vault.newerVersion', 'Vault created by a newer version of nullbrand.');
  const kdf = raw['kdf'];
  validateKdf(kdf);
  if (!raw['payload'] || !isEncryptedBox(raw['payload'])) {
    throw coded('err.vault.corrupted', 'Corrupted vault (missing payload).');
  }
  if (!isVaultFile(raw)) throw coded('err.vault.corrupted', 'Corrupted vault (missing payload).');
  checkBoxTag(raw.payload);
  return raw;
}

export function vaultExists(path: string = defaultVaultPath()): boolean {
  return existsSync(path);
}

// Removes the vault file. Backups exported elsewhere are not touched.
export async function destroyVault(path: string = defaultVaultPath()): Promise<void> {
  await fs.unlink(path);
}

// Identity item fields (key → maximum length).
export const IDENTITY_FIELDS = {
  fullName: 128, email: 254, phone: 32, birthDate: 10,
  rg: 32, cpf: 14, pis: 14, cnpj: 18, cnh: 20, passport: 20,
  address: 256, city: 128, state: 64, zip: 9, country: 64,
} as const satisfies Record<IdentityKey, number>;

// SSH Key item fields (key → maximum length).
export const SSH_FIELDS = {
  sshAlgo: 16, sshTitle: 128, sshPublicKey: 1000, sshFingerprint: 64, sshPrivateKey: 10000,
  sshHost: 253, sshUser: 64, sshPort: 5,
} as const satisfies Record<SshKey, number>;

// Host, user and port go into ~/.ssh/config: no spaces or line breaks.
function sshValue(key: string, v: string): string {
  if (key === 'sshHost' || key === 'sshUser') return v.replace(/\s+/g, '');
  if (key === 'sshPort') return v.replace(/\D/g, '');
  if (key === 'sshPrivateKey') return v.trim() ? v.trim() + '\n' : '';
  return v.trim();
}

// What normalizeItem() reads: an object whose values are untrusted (UI body, CLI flags, an import).
export type ItemInput = Readonly<Record<string, unknown>>;

// `id` and `createdAt` end up typed `string` in the stored item, so a value that was GIVEN (truthy) must be a string. Falsy means
// "not given" exactly as before. A truthy non-string used to be stored as is and made the vault impossible to open next time.
function givenString(value: unknown, field: string): string {
  if (!value) return '';
  if (typeof value !== 'string') throw coded('err.vault.invalidField', `Invalid value for "${field}".`, { field });
  return value;
}

// Normalizes an item coming from the UI, the CLI or an import.
export function normalizeItem(input: ItemInput, existing: VaultItem | null = null): VaultItem {
  const now = new Date().toISOString();
  const str = (v: unknown, max: number = 10000): string => (typeof v === 'string' ? v.slice(0, max) : '');
  const inputType = input['type'];
  const type: ItemType = inputType === 'note' || inputType === 'card' || inputType === 'identity' || inputType === 'ssh' ? inputType : 'login';
  const rawUris = input['uris'];
  const rawUri = input['uri'];
  const uris: readonly unknown[] = isUnknownArray(rawUris) ? rawUris : typeof rawUri === 'string' ? [rawUri] : [];
  const item = {
    id: existing?.id || givenString(input['id'], 'id') || randomUUID(),
    type,
    name: str(input['name'], 128).trim() || '(unnamed)',
    username: type === 'login' ? str(input['username'], 500) : '',
    password: type === 'login' ? str(input['password'], 2000) : '',
    uris: type === 'login' ? uris.map((u) => str(u, 2000).trim()).filter(Boolean).slice(0, 20) : [],
    totp: type === 'login' ? str(input['totp'], 500) : '',
    cardholder: type === 'card' ? str(input['cardholder'], 128).trim() : '',
    cardNumber: type === 'card' ? str(input['cardNumber'], 19).trim() : '',
    cardExpiry: type === 'card' ? str(input['cardExpiry'], 7).trim() : '',
    cardCvv: type === 'card' ? str(input['cardCvv'], 4).trim() : '',
    ...Object.fromEntries(Object.entries(IDENTITY_FIELDS).map(([k, max]): [string, string] => [k, type === 'identity' ? str(input[k], max).trim() : ''])),
    ...Object.fromEntries(Object.entries(SSH_FIELDS).map(([k, max]): [string, string] => [k, type === 'ssh' ? sshValue(k, str(input[k], max)) : ''])),
    notes: str(input['notes'], 20000),
    folder: str(input['folder'], FOLDER_MAX).trim(),
    favorite: Boolean(input['favorite']),
    createdAt: existing?.createdAt || givenString(input['createdAt'], 'createdAt') || now,
    updatedAt: now,
  };
  // Always true for what was just built; it is what turns the flat object into the VaultItem union for the compiler.
  if (!isVaultItem(item)) throw coded('err.vault.invalidItem', 'Invalid vault item.', { position: 0, id: item.id, name: item.name, field: 'item' });
  return item;
}

function invalidContent(field: string) {
  return coded('err.vault.invalidContent', `Invalid vault content (${field}).`, { field });
}

// Item read from disk -> complete item. PURE: only fills ABSENT fields with their defaults; it does not touch
// id/createdAt/updatedAt, does not truncate or trim, keeps unknown extra fields and writes nothing (the file only changes on
// the next save, as before). A missing `type` is a login (the original format had no `type`). Anything that cannot be
// represented faithfully is rejected instead of being converted: converting would lose data on the next save.
export function normalizeStoredItem(raw: unknown, index: number = 0): VaultItem {
  // id/name/position let the user find the item in the JSON when fixing it by hand.
  const who = (): { position: number; id: string; name: string } => {
    const obj = isObjectLike(raw) && !Array.isArray(raw);
    const show = (v: unknown): string => (typeof v === 'string' && v ? v : '(none)');
    return { position: index + 1, id: show(obj ? raw['id'] : undefined), name: show(obj ? raw['name'] : undefined) };
  };
  const invalid = (field: string) => {
    const w = who();
    return coded('err.vault.invalidItem', `Invalid vault item #${w.position} (id: ${w.id}, name: ${w.name}): problem in field "${field}".`, { ...w, field });
  };
  if (!isObjectLike(raw) || Array.isArray(raw)) throw invalid('item');
  if (typeof raw['id'] !== 'string' || !raw['id']) throw invalid('id');
  const rawType = raw['type'] === undefined ? 'login' : raw['type'];
  if (!isItemType(rawType)) {
    const w = who();
    throw coded('err.vault.unknownItemType', `Vault item #${w.position} (id: ${w.id}, name: ${w.name}) has an unknown type "${String(rawType)}"; this vault may come from a newer version of nullbrand.`, { ...w, type: String(rawType) });
  }
  const type: ItemType = rawType;
  const item: Record<string, unknown> = { ...raw, type };
  const str = (field: string, fallback: string = ''): void => {
    if (item[field] === undefined) item[field] = fallback;
    else if (typeof item[field] !== 'string') throw invalid(field);
  };
  str('name', '(unnamed)');
  str('notes');
  str('folder');
  str('createdAt');
  str('updatedAt');
  if (item['favorite'] === undefined) item['favorite'] = false;
  else if (typeof item['favorite'] !== 'boolean') throw invalid('favorite');
  const uris = item['uris'];
  let urisCount = 0;
  if (uris === undefined) item['uris'] = [];
  else if (isStringArray(uris)) urisCount = uris.length;
  else throw invalid('uris');
  for (const [owner, fields] of [['login', LOGIN_KEYS], ['card', CARD_KEYS], ['identity', IDENTITY_KEYS], ['ssh', SSH_KEYS]] as const) {
    for (const f of fields) {
      str(f);
      if (owner !== type && item[f] !== '') throw invalid(f);
    }
  }
  if (type !== 'login' && urisCount > 0) throw invalid('uris');
  if (!isVaultItem(item)) throw invalid('item');
  return item;
}

function cleanFolderName(name: unknown): string {
  const clean = typeof name === 'string' ? name.slice(0, FOLDER_MAX).trim() : '';
  if (!clean) throw coded('err.vault.folderNameRequired', 'Enter the folder name.');
  return clean;
}

export interface VaultMigration {
  from: { version: number; N: number; r: number; p: number };
  backup: string;
}

// What the encrypted payload of a vault holds: the (untrusted) items and folders.
type VaultContent = Readonly<Record<string, unknown>>;

export class Vault {
  declare path: string;
  declare header: VaultHeader;
  declare key: DerivedKey;
  declare items: VaultItem[];
  declare folders: string[];
  declare migration?: VaultMigration;
  declare migrationError?: string | undefined;

  constructor(path: string, header: VaultHeader, key: DerivedKey, content: VaultContent) {
    this.path = path;
    this.header = header;
    this.key = key;
    const rawItems = content['items'];
    if (!isUnknownArray(rawItems)) throw invalidContent('items'); // missing/null is corruption, not "empty": the next save would erase the vault
    this.items = rawItems.map((raw, i) => normalizeStoredItem(raw, i));
    // Explicit folders (allow empty folders). Old vaults don't have this field.
    const rawFolders = content['folders'];
    if (rawFolders !== undefined && !isStringArray(rawFolders)) throw invalidContent('folders');
    this.folders = isStringArray(rawFolders) ? [...rawFolders] : [];
  }

  static async create(password: string, path: string = defaultVaultPath()): Promise<Vault> {
    if (existsSync(path)) throw coded('err.vault.exists', `A vault already exists at ${path}`, { path });
    if (!password || password.length < 8) throw coded('err.vault.passwordShort', 'The master password must be at least 8 characters long.');
    const header: VaultHeader = { format: FORMAT, version: VERSION, kdf: newKdfParams() };
    const key = await deriveKey(toMasterPassword(password), header.kdf);
    const vault = new Vault(path, header, key, { items: [] });
    await vault.save();
    return vault;
  }

  // migrate: false opens without rewriting anything (password confirmations, reading others' backups).
  // Old vault (v1 or KDF below the minimum): after opening, makes a backup, re-derives with new
  // parameters and rewrites. A failed migration does NOT block access: the original file stays intact and the
  // reason is kept in vault.migrationError. On success: vault.migration = { from, backup }.
  static async unlock(password: string, path: string = defaultVaultPath(), { migrate = true }: { migrate?: boolean } = {}): Promise<Vault> {
    const file = await readVaultFile(path);
    const header: VaultHeader = { format: file.format, version: file.version, kdf: file.kdf };
    const key = await deriveKey(toMasterPassword(password), header.kdf);
    // The derived key must not outlive a failed open: decrypting, checking the content and building the Vault (which can refuse an
    // invalid item, an unknown type or a bad content shape) all happen inside this try.
    let vault: Vault;
    try {
      const decrypted = decryptJson(key, file.payload, headerAad(header));
      if (!isObjectLike(decrypted)) throw invalidContent('payload');
      vault = new Vault(path, header, key, decrypted);
    } catch (err) {
      key.fill(0);
      throw err;
    }
    if (migrate && (header.version < VERSION || isWeakKdf(header.kdf))) {
      try {
        await vault.#migrate(password);
      } catch (err) {
        vault.migrationError = isObjectLike(err) && typeof err['message'] === 'string' ? err['message'] : undefined;
      }
    }
    return vault;
  }

  async #migrate(password: string): Promise<void> {
    const from = { version: this.header.version, N: this.header.kdf.N, r: this.header.kdf.r, p: this.header.kdf.p };
    const header: VaultHeader = { format: FORMAT, version: VERSION, kdf: newKdfParams() };
    const key = await deriveKey(toMasterPassword(password), header.kdf);
    try {
      const text = this.serialize(header, key);
      // Check that what goes to disk opens with the new key before touching the original.
      const written: unknown = JSON.parse(text);
      const payload = isObjectLike(written) ? written['payload'] : undefined;
      if (!isEncryptedBox(payload)) throw coded('err.vault.corrupted', 'Corrupted vault (missing payload).');
      decryptJson(key, payload, headerAad(header));
      const backup = await backupVaultFile(this.path);
      await writeAtomic(this.path, text);
      this.key.fill(0);
      this.header = header;
      this.key = key;
      this.migration = { from, backup };
    } catch (err) {
      key.fill(0);
      throw err;
    }
  }

  serialize(header: VaultHeader = this.header, key: DerivedKey = this.key): string {
    const payload = encryptJson(key, { items: this.items, folders: this.folders }, headerAad(header));
    return JSON.stringify({ ...header, updatedAt: new Date().toISOString(), payload }, null, 2) + '\n';
  }

  async save(): Promise<void> {
    await writeAtomic(this.path, this.serialize());
  }

  async changePassword(newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8) throw coded('err.vault.passwordShort', 'The master password must be at least 8 characters long.');
    const header: VaultHeader = { format: FORMAT, version: VERSION, kdf: newKdfParams() };
    const key = await deriveKey(toMasterPassword(newPassword), header.kdf);
    try {
      await writeAtomic(this.path, this.serialize(header, key));
    } catch (err) {
      key.fill(0); // write failed: the file and the in-memory key remain the old ones
      throw err;
    }
    this.key.fill(0);
    this.header = header;
    this.key = key;
  }

  list(): VaultItem[] {
    return [...this.items].sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'en')
    );
  }

  find(query: string): VaultItem[] {
    const q = String(query).toLowerCase();
    return this.list().filter(
      (i) => i.id === query || i.name.toLowerCase().includes(q) || i.username.toLowerCase().includes(q) ||
        i.uris.some((u) => u.toLowerCase().includes(q))
    );
  }

  get(id: string): VaultItem | null {
    return this.items.find((i) => i.id === id) || null;
  }

  // Applies `change` (which replaces this.items / this.folders, never mutates them in place) and saves. If the save rejects,
  // the in-memory state goes back to exactly what it was and the original error is rethrown, so memory never shows
  // something the disk does not have.
  async #commit<T>(change: () => T): Promise<T> {
    const items = this.items;
    const folders = this.folders;
    try {
      const result = change();
      await this.save();
      return result;
    } catch (err) {
      this.items = items;
      this.folders = folders;
      throw err;
    }
  }

  // `input` is whatever the UI sent (an HTTP body): normalizeItem() reads it field by field.
  async add(input: unknown): Promise<VaultItem> {
    const item = normalizeItem({ ...spreadOf(input), id: undefined });
    return this.#commit(() => {
      this.items = [...this.items, item];
      return item;
    });
  }

  async update(id: string, input: unknown): Promise<VaultItem> {
    const idx = this.items.findIndex((i) => i.id === id);
    const current = this.items[idx];
    if (idx < 0 || current === undefined) throw coded('err.vault.itemNotFound', 'Item not found.');
    const next = normalizeItem({ ...current, ...spreadOf(input) }, current);
    return this.#commit(() => {
      this.items = this.items.map((i, n) => (n === idx ? next : i));
      return next;
    });
  }

  async remove(id: string): Promise<void> {
    if (!this.items.some((i) => i.id === id)) throw coded('err.vault.itemNotFound', 'Item not found.');
    await this.#commit(() => {
      this.items = this.items.filter((i) => i.id !== id);
    });
  }

  async removeMany(ids: readonly string[]): Promise<void> {
    const set = new Set(ids);
    await this.#commit(() => {
      this.items = this.items.filter((i) => !set.has(i.id));
    });
  }

  // Explicit folders + folders used by items, without duplicates (case-insensitive).
  listFolders(): string[] {
    const seen = new Map<string, string>();
    for (const f of [...this.folders, ...this.items.map((i) => i.folder)]) {
      if (f && !seen.has(f.toLowerCase())) seen.set(f.toLowerCase(), f);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en'));
  }

  #canonicalFolder(name: string): string | null {
    return this.listFolders().find((f) => f.toLowerCase() === name.toLowerCase()) || null;
  }

  // Creates the folder (or returns the existing one with the same name).
  async addFolder(name: unknown): Promise<string> {
    const clean = cleanFolderName(name);
    const existing = this.#canonicalFolder(clean);
    if (existing) return existing;
    return this.#commit(() => {
      this.folders = [...this.folders, clean];
      return clean;
    });
  }

  // Renames; if the new name already exists as another folder, the two are merged.
  async renameFolder(from: string, to: unknown): Promise<string> {
    const cleanTo = cleanFolderName(to);
    const source = this.#canonicalFolder(from);
    if (!source) throw coded('err.vault.folderNotFound', 'Folder not found.');
    const target = this.#canonicalFolder(cleanTo);
    const finalName = target && target.toLowerCase() !== source.toLowerCase() ? target : cleanTo;
    return this.#commit(() => {
      this.items = this.items.map((i) => (i.folder === source ? normalizeItem({ ...i, folder: finalName }, i) : i));
      this.folders = [...new Set([...this.folders.filter((f) => f !== source), finalName])];
      return finalName;
    });
  }

  // Deletes the folder. By default its items become folderless; with deleteItems they are removed too.
  async deleteFolder(name: unknown, { deleteItems = false }: { deleteItems?: boolean } = {}): Promise<{ count: number }> {
    const source = this.#canonicalFolder(String(name || ''));
    if (!source) throw coded('err.vault.folderNotFound', 'Folder not found.');
    const inFolder = this.items.filter((i) => i.folder === source);
    return this.#commit(() => {
      this.items = deleteItems
        ? this.items.filter((i) => i.folder !== source)
        : this.items.map((i) => (i.folder === source ? normalizeItem({ ...i, folder: '' }, i) : i));
      this.folders = this.folders.filter((f) => f !== source);
      return { count: inFolder.length };
    });
  }

  async moveMany(ids: readonly string[], folder: string): Promise<void> {
    const set = new Set(ids);
    await this.#commit(() => {
      this.items = this.items.map((i) => (set.has(i.id) ? normalizeItem({ ...i, folder }, i) : i));
    });
  }

  // Merges imported items, skipping exact duplicates (same name+username+password+URIs).
  async merge(items: readonly Readonly<Record<string, unknown>>[]): Promise<{ added: number; skipped: number }> {
    const sig = (i: VaultItem): string => JSON.stringify([i.type, i.name, i.username, i.password, i.uris, i.notes, i.cardNumber, i.cardCvv, i.cpf, i.cnpj, i.passport, i.email, i.sshFingerprint]);
    const seen = new Set(this.items.map(sig));
    // All-or-nothing: every item is normalized (and checked for duplicates) into this local list first. If any of them throws, this.items
    // has not been touched, so a later save() of something else cannot write half of a failed import.
    const fresh: VaultItem[] = [];
    let skipped = 0;
    for (const raw of items) {
      const item = normalizeItem({ ...raw, id: undefined });
      const rawCreatedAt = raw['createdAt'];
      item.createdAt = (typeof rawCreatedAt === 'string' && rawCreatedAt) || item.createdAt;
      if (seen.has(sig(item))) {
        skipped++;
        continue;
      }
      seen.add(sig(item));
      fresh.push(item);
    }
    return this.#commit(() => {
      this.items = [...this.items, ...fresh];
      return { added: fresh.length, skipped };
    });
  }

  // Backup: the vault itself, already encrypted, in another file.
  async exportBackup(destPath: string): Promise<string> {
    await writeAtomic(destPath, this.serialize());
    return destPath;
  }
}

// Checks a master password against the vault file without touching the open vault. Rejects with a WrongPasswordError.
export async function verifyMasterPassword(password: string, path: string = defaultVaultPath()): Promise<void> {
  (await Vault.unlock(password, path, { migrate: false })).key.fill(0);
}

// Writes a file that holds secrets in the clear (an unencrypted export). It is created private to the owner (0600) and replaced
// atomically, so it is never readable by anyone else, not even for a moment.
export async function writePrivateFile(destPath: string, text: string): Promise<string> {
  await writeAtomic(destPath, text);
  return destPath;
}

// Reads a backup (another vault file) with its own password and returns the items.
export async function readBackupItems(path: string, password: string): Promise<VaultItem[]> {
  const backup = await Vault.unlock(password, path, { migrate: false });
  backup.key.fill(0);
  return backup.items;
}

export async function readBackupItemsFromText(text: string, password: string): Promise<VaultItem[]> {
  let raw: unknown;
  try {
    const parsed: unknown = JSON.parse(text);
    raw = parsed;
  } catch {
    throw coded('err.vault.notBackup', 'This file is not a nullbrand backup.');
  }
  if (!isObjectLike(raw)) throw coded('err.vault.notBackup', 'This file is not a nullbrand backup.');
  if (raw['format'] !== FORMAT) throw coded('err.vault.notBackup', 'This file is not a nullbrand backup.');
  const format = raw['format'];
  const version = raw['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > VERSION) throw coded('err.vault.backupVersion', 'Unsupported backup version.');
  const kdf = raw['kdf'];
  validateKdf(kdf);
  const header: VaultHeader = { format, version, kdf };
  const earlyPayload = raw['payload'];
  if (isEncryptedBox(earlyPayload)) checkBoxTag(earlyPayload);
  const key = await deriveKey(toMasterPassword(password), header.kdf);
  try {
    const payload = raw['payload'];
    if (!isEncryptedBox(payload)) throw coded('err.vault.notBackup', 'This file is not a nullbrand backup.');
    const content = decryptJson(key, payload, headerAad(header));
    if (!isObjectLike(content)) throw invalidContent('payload');
    const items = content['items'];
    if (items === undefined) return []; // a backup is only read and merged, never saved over: a missing field is just "nothing to import"
    if (!isUnknownArray(items)) throw invalidContent('items');
    return items.map((item, i) => normalizeStoredItem(item, i));
  } finally {
    key.fill(0);
  }
}
