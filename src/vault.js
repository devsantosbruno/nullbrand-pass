// Arquivo do cofre: um único JSON com cabeçalho em texto claro (versão, KDF)
// e o conteúdo (itens) cifrado com AES-256-GCM. Nada sai desta máquina.
import { promises as fs, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { deriveKey, newKdfParams, encryptJson, decryptJson } from './crypto.js';

export const FORMAT = 'voltrama-pass-vault';
export const VERSION = 1;

export function defaultHome() {
  return process.env.VOLTRAMA_PASS_HOME || join(homedir(), '.voltrama-pass');
}

export function defaultVaultPath() {
  return join(defaultHome(), 'vault.json');
}

function headerAad(header) {
  return `${header.format}:${header.version}:${JSON.stringify(header.kdf)}`;
}

async function writeAtomic(path, text) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, path);
}

export async function readVaultFile(path) {
  const raw = JSON.parse(await fs.readFile(path, 'utf8'));
  if (raw.format !== FORMAT) throw new Error('Este arquivo não é um cofre do voltrama-pass.');
  if (raw.version > VERSION) throw new Error('Cofre criado por uma versão mais nova do voltrama-pass.');
  return raw;
}

export function vaultExists(path = defaultVaultPath()) {
  return existsSync(path);
}

// Normaliza um item vindo da UI, da CLI ou de um import.
export function normalizeItem(input, existing = null) {
  const now = new Date().toISOString();
  const str = (v, max = 10000) => (typeof v === 'string' ? v.slice(0, max) : '');
  const type = input.type === 'note' ? 'note' : 'login';
  const uris = Array.isArray(input.uris) ? input.uris : typeof input.uri === 'string' ? [input.uri] : [];
  const item = {
    id: existing?.id || input.id || randomUUID(),
    type,
    name: str(input.name, 300).trim() || '(sem nome)',
    username: type === 'login' ? str(input.username, 500) : '',
    password: type === 'login' ? str(input.password, 2000) : '',
    uris: type === 'login' ? uris.map((u) => str(u, 2000).trim()).filter(Boolean).slice(0, 20) : [],
    totp: type === 'login' ? str(input.totp, 500) : '',
    notes: str(input.notes, 20000),
    folder: str(input.folder, 200).trim(),
    favorite: Boolean(input.favorite),
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  };
  return item;
}

export class Vault {
  constructor(path, header, key, content) {
    this.path = path;
    this.header = header;
    this.key = key;
    this.items = content.items || [];
  }

  static async create(password, path = defaultVaultPath()) {
    if (existsSync(path)) throw new Error(`Já existe um cofre em ${path}`);
    if (!password || password.length < 8) throw new Error('A senha mestra precisa ter pelo menos 8 caracteres.');
    const header = { format: FORMAT, version: VERSION, kdf: newKdfParams() };
    const key = await deriveKey(password, header.kdf);
    const vault = new Vault(path, header, key, { items: [] });
    await vault.save();
    return vault;
  }

  static async unlock(password, path = defaultVaultPath()) {
    const file = await readVaultFile(path);
    const header = { format: file.format, version: file.version, kdf: file.kdf };
    const key = await deriveKey(password, header.kdf);
    const content = decryptJson(key, file.payload, headerAad(header));
    return new Vault(path, header, key, content);
  }

  serialize() {
    const payload = encryptJson(this.key, { items: this.items }, headerAad(this.header));
    return JSON.stringify({ ...this.header, updatedAt: new Date().toISOString(), payload }, null, 2) + '\n';
  }

  async save() {
    await writeAtomic(this.path, this.serialize());
  }

  async changePassword(newPassword) {
    if (!newPassword || newPassword.length < 8) throw new Error('A senha mestra precisa ter pelo menos 8 caracteres.');
    this.header = { ...this.header, kdf: newKdfParams() };
    this.key = await deriveKey(newPassword, this.header.kdf);
    await this.save();
  }

  list() {
    return [...this.items].sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR')
    );
  }

  find(query) {
    const q = String(query).toLowerCase();
    return this.list().filter(
      (i) => i.id === query || i.name.toLowerCase().includes(q) || i.username.toLowerCase().includes(q) ||
        i.uris.some((u) => u.toLowerCase().includes(q))
    );
  }

  get(id) {
    return this.items.find((i) => i.id === id) || null;
  }

  async add(input) {
    const item = normalizeItem({ ...input, id: undefined });
    this.items.push(item);
    await this.save();
    return item;
  }

  async update(id, input) {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error('Item não encontrado.');
    this.items[idx] = normalizeItem({ ...this.items[idx], ...input }, this.items[idx]);
    await this.save();
    return this.items[idx];
  }

  async remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length === before) throw new Error('Item não encontrado.');
    await this.save();
  }

  // Mescla itens importados, ignorando duplicatas exatas (mesmo nome+usuário+senha+URIs).
  async merge(items) {
    const sig = (i) => JSON.stringify([i.type, i.name, i.username, i.password, i.uris, i.notes]);
    const seen = new Set(this.items.map(sig));
    let added = 0;
    let skipped = 0;
    for (const raw of items) {
      const item = normalizeItem({ ...raw, id: undefined });
      item.createdAt = raw.createdAt || item.createdAt;
      if (seen.has(sig(item))) {
        skipped++;
        continue;
      }
      seen.add(sig(item));
      this.items.push(item);
      added++;
    }
    await this.save();
    return { added, skipped };
  }

  // Backup: o próprio cofre, já cifrado, em outro arquivo.
  async exportBackup(destPath) {
    await writeAtomic(destPath, this.serialize());
    return destPath;
  }
}

// Lê um backup (outro arquivo de cofre) com a senha dele e devolve os itens.
export async function readBackupItems(path, password) {
  const backup = await Vault.unlock(password, path);
  return backup.items;
}

export async function readBackupItemsFromText(text, password) {
  const raw = JSON.parse(text);
  if (raw.format !== FORMAT) throw new Error('Este arquivo não é um backup do voltrama-pass.');
  const header = { format: raw.format, version: raw.version, kdf: raw.kdf };
  const key = await deriveKey(password, header.kdf);
  return decryptJson(key, raw.payload, headerAad(header)).items || [];
}
