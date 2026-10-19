// The plain (unencrypted) writers. Where the target layout has no place for a field they are lossy on purpose, and say so in `warnings`
// rather than drop data quietly: what has no counterpart goes into the notes as `key: value` lines.
import { assertNever, ownedKeys } from '../shared/vault-types.js';
import type { VaultItem } from '../shared/vault-types.js';
import type { FormatWarning } from './types.js';

/** A serialized export and what was lossy in it. */
export interface ExportResult {
  text: string;
  warnings: FormatWarning[];
}
/** An {@link ExportResult} with the name and MIME type the file should get. */
export interface PlainExport extends ExportResult {
  filename: string;
  mime: string;
}

// `key: value` lines for every filled field of the item's own type; they carry what a flat layout cannot.
function detailLines(item: VaultItem, only: readonly string[] = ownedKeys(item.type)): string[] {
  const record: Readonly<Record<string, unknown>> = item;
  return only.flatMap((key) => {
    const value = record[key];
    return typeof value === 'string' && value !== '' ? [`${key}: ${value}`] : [];
  });
}

const joinNotes = (...parts: readonly string[]): string => parts.filter(Boolean).join('\n\n');

// ---- JSON (nested layout) ----

// Splits "MM/YY" or "MM/YYYY" into the layout's two fields.
function splitExpiry(expiry: string): { month: string; year: string } | undefined {
  const match = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(expiry.trim());
  return match?.[1] !== undefined && match[2] !== undefined ? { month: match[1], year: match[2] } : undefined;
}

// Identity fields with no place in the layout; they travel in the notes.
const IDENTITY_UNMAPPED = ['birthDate', 'rg', 'pis', 'cnpj'] as const;

interface NestedItem {
  readonly body: Readonly<Record<string, unknown>>;
  readonly type: 1 | 2 | 3 | 4;
  readonly notes: string;
  readonly movedToNotes: boolean;
  readonly asNote: boolean;
}

function nestedBody(item: VaultItem): NestedItem {
  switch (item.type) {
    case 'login':
      return {
        type: 1,
        body: { login: { username: item.username, password: item.password, totp: item.totp || null, uris: item.uris.map((uri) => ({ uri })) } },
        notes: item.notes,
        movedToNotes: false,
        asNote: false,
      };
    case 'note':
      return { type: 2, body: {}, notes: item.notes, movedToNotes: false, asNote: false };
    case 'card': {
      const expiry = splitExpiry(item.cardExpiry);
      const unparsed = item.cardExpiry !== '' && expiry === undefined;
      return {
        type: 3,
        body: { card: { cardholderName: item.cardholder, number: item.cardNumber, expMonth: expiry?.month ?? '', expYear: expiry?.year ?? '', code: item.cardCvv } },
        notes: joinNotes(item.notes, unparsed ? `cardExpiry: ${item.cardExpiry}` : ''),
        movedToNotes: unparsed,
        asNote: false,
      };
    }
    case 'identity': {
      const leftovers = detailLines(item, IDENTITY_UNMAPPED);
      return {
        type: 4,
        body: {
          identity: {
            firstName: item.fullName,
            email: item.email,
            phone: item.phone,
            ssn: item.cpf,
            licenseNumber: item.cnh,
            passportNumber: item.passport,
            address1: item.address,
            city: item.city,
            state: item.state,
            postalCode: item.zip,
            country: item.country,
          },
        },
        notes: joinNotes(item.notes, leftovers.join('\n')),
        movedToNotes: leftovers.length > 0,
        asNote: false,
      };
    }
    case 'ssh':
      return { type: 2, body: {}, notes: joinNotes(item.notes, detailLines(item).join('\n')), movedToNotes: false, asNote: true };
    default:
      return assertNever(item);
  }
}

function writeJson(items: readonly VaultItem[], folders: readonly string[]): ExportResult {
  const warnings: FormatWarning[] = [];
  const folderIds = new Map(folders.map((name, index) => [name.toLowerCase(), `folder-${index + 1}`]));
  let moved = 0;
  const out = items.map((item) => {
    const nested = nestedBody(item);
    if (nested.asNote) warnings.push({ key: 'export.warn.sshAsNote', params: { name: item.name } });
    if (nested.movedToNotes) moved++;
    return {
      id: item.id,
      folderId: folderIds.get(item.folder.toLowerCase()) ?? null,
      type: nested.type,
      name: item.name,
      notes: nested.notes || null,
      favorite: item.favorite,
      creationDate: item.createdAt,
      revisionDate: item.updatedAt,
      ...nested.body,
    };
  });
  if (moved > 0) warnings.push({ key: 'export.warn.movedToNotes', params: { count: moved } });
  const document = { encrypted: false, folders: folders.map((name, index) => ({ id: `folder-${index + 1}`, name })), items: out };
  return { text: JSON.stringify(document, null, 2) + '\n', warnings };
}

/** Serializes the items and folders as one unencrypted JSON file. Callers must treat the result as sensitive. */
export function exportPlain(items: readonly VaultItem[], folders: readonly string[], now: Date = new Date()): PlainExport {
  return { ...writeJson(items, folders), filename: `nullbrand-export-${now.toISOString().slice(0, 10)}.json`, mime: 'application/json; charset=utf-8' };
}
