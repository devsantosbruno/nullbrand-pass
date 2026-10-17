// Imports the *unencrypted* Bitwarden JSON export
// (Bitwarden → Tools → Export vault → ".json" format).
// Supported types: 1 = Login, 2 = Note, 4 = Identity. Cards (3)
// become notes so no data is lost.
//
// The export is untrusted input: every value is read as `unknown` and narrowed here, field by field.

import { coded } from '../errors.js';
import { isObjectLike, isUnknownArray } from '../shared/guards.js';

const TYPE_LOGIN = 1;
const TYPE_NOTE = 2;
const TYPE_CARD = 3;
const TYPE_IDENTITY = 4;

type ImportedBase = {
  name: string;
  folder: string;
  favorite: boolean;
  createdAt: string | undefined;
};
export type ImportedItem =
  | (ImportedBase & { type: 'login'; username: string; password: string; totp: string; uris: string[]; notes: string })
  | (ImportedBase & { type: 'note'; notes: string })
  | (ImportedBase & {
      type: 'identity';
      fullName: string;
      email: string;
      phone: string;
      passport: string;
      cpf: string;
      cnh: string;
      address: string;
      city: string;
      state: string;
      zip: string;
      country: string;
      notes: string;
    });

// `value || fallback` for a value that must end up a string. A non-string (a number, an object...) is not a usable text field.
const text = (value: unknown, fallback: string = ''): string => (typeof value === 'string' && value ? value : fallback);

// An entry of a list inside the export. null / undefined used to blow up with a TypeError on the first property read.
function entry(value: unknown, where: string): Readonly<Record<string, unknown>> {
  if (value === null || value === undefined) throw coded('err.bitwarden.invalidEntry', `Invalid Bitwarden export entry (${where}).`, { where });
  return isObjectLike(value) ? value : {};
}

function fieldsToText(fields: unknown): string {
  if (!isUnknownArray(fields) || fields.length === 0) return '';
  return fields
    .map((f) => {
      const field = entry(f, 'fields');
      return `${field['name'] ?? ''}: ${field['value'] ?? ''}`;
    })
    .join('\n');
}

function objectToText(obj: unknown): string {
  if (!obj || !isObjectLike(obj)) return '';
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

export function parseBitwardenExport(source: unknown): { items: ImportedItem[]; ignored: number } {
  let data: unknown;
  try {
    if (typeof source === 'string') {
      const parsed: unknown = JSON.parse(source);
      data = parsed;
    } else {
      data = source;
    }
  } catch {
    throw coded('err.bitwarden.notJson', 'Invalid file: not JSON.');
  }
  const root: Readonly<Record<string, unknown>> = isObjectLike(data) ? data : {};
  if (root['encrypted'] === true) {
    throw coded('err.bitwarden.encrypted', 'This Bitwarden export is encrypted. Export again in the ".json" format (not the "encrypted" one).');
  }
  const rawItems = root['items'];
  if (!isUnknownArray(rawItems)) throw coded('err.bitwarden.noItems', 'Could not find the "items" list of a Bitwarden export.');

  const rawFolders = root['folders'] || [];
  if (!isUnknownArray(rawFolders)) throw coded('err.bitwarden.invalidEntry', 'Invalid Bitwarden export entry (folders).', { where: 'folders' });
  const folders = new Map<unknown, unknown>(
    rawFolders.map((f): [unknown, unknown] => {
      const folder = entry(f, 'folders');
      return [folder['id'], folder['name']];
    }),
  );
  const items: ImportedItem[] = [];
  let ignored = 0;

  for (const rawItem of rawItems) {
    const it = entry(rawItem, 'items');
    if (it['deletedDate']) {
      ignored++;
      continue;
    }
    const base: ImportedBase = {
      name: text(it['name'], '(unnamed)'),
      folder: text(folders.get(it['folderId'])),
      favorite: Boolean(it['favorite']),
      createdAt: text(it['creationDate']) || undefined,
    };
    const extra = fieldsToText(it['fields']);
    const notesWithExtra = [text(it['notes']), extra ? `Custom fields:\n${extra}` : ''].filter(Boolean).join('\n\n');

    if (it['type'] === TYPE_LOGIN) {
      const login = entry(it['login'] || {}, 'login');
      const rawUris = login['uris'] || [];
      if (!isUnknownArray(rawUris)) throw coded('err.bitwarden.invalidEntry', 'Invalid Bitwarden export entry (login uris).', { where: 'login uris' });
      items.push({
        ...base,
        type: 'login',
        username: text(login['username']),
        password: text(login['password']),
        totp: text(login['totp']),
        uris: rawUris.map((u) => (isObjectLike(u) ? u['uri'] : undefined)).filter((u) => typeof u === 'string' && u !== '').map(String),
        notes: notesWithExtra,
      });
    } else if (it['type'] === TYPE_NOTE) {
      items.push({ ...base, type: 'note', notes: notesWithExtra });
    } else if (it['type'] === TYPE_IDENTITY && it['identity']) {
      const d = entry(it['identity'], 'identity');
      const fullName = [d['firstName'], d['middleName'], d['lastName']].filter(Boolean).join(' ');
      const address = [d['address1'], d['address2'], d['address3']].filter(Boolean).join(', ');
      items.push({
        ...base,
        type: 'identity',
        fullName,
        email: text(d['email']),
        phone: text(d['phone']),
        passport: text(d['passportNumber']),
        cpf: text(d['ssn']),
        cnh: text(d['licenseNumber']),
        address,
        city: text(d['city']),
        state: text(d['state']),
        zip: text(d['postalCode']),
        country: text(d['country']),
        notes: notesWithExtra,
      });
    } else if (it['type'] === TYPE_CARD) {
      const label = 'Card';
      const body = objectToText(it['card']);
      items.push({ ...base, type: 'note', notes: [`[${label} imported from Bitwarden]`, body, notesWithExtra].filter(Boolean).join('\n\n') });
    } else {
      ignored++;
    }
  }
  return { items, ignored };
}
