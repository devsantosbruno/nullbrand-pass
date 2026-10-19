// Adapter for the nested JSON layout `{ folders: [{ id, name }], items: [{ type, folderId, login | card | identity, ... }] }`,
// as several password managers write their unencrypted export. Item types: 1 = login, 2 = note, 3 = card, 4 = identity; others are ignored.
// The file is untrusted: every value is read as `unknown` and narrowed field by field.
import { coded } from '../errors.js';
import { isObjectLike, isUnknownArray } from '../shared/guards.js';
import type { ImportAdapter, InterchangeItem, ParseResult } from './types.js';

const TYPE_LOGIN = 1;
const TYPE_NOTE = 2;
const TYPE_CARD = 3;
const TYPE_IDENTITY = 4;

type Common = Pick<InterchangeItem, 'name' | 'folder' | 'favorite' | 'createdAt'>;

// `value || fallback` for a field that must be a string; any non-string is unusable.
const text = (value: unknown, fallback: string = ''): string => (typeof value === 'string' && value ? value : fallback);

// An entry of a list in the file. null and undefined are rejected; other non-objects become empty.
function entry(value: unknown, where: string): Readonly<Record<string, unknown>> {
  if (value === null || value === undefined) throw coded('err.import.invalidEntry', `Invalid entry in the file (${where}).`, { where });
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

// "MM/YYYY" from the two fields, when both exist.
function cardExpiry(month: unknown, year: unknown): string {
  const m = text(month);
  const y = text(year);
  return m && y ? `${m.padStart(2, '0')}/${y}` : '';
}

function identityItem(common: Common, d: Readonly<Record<string, unknown>>, notes: string): InterchangeItem {
  return {
    ...common,
    type: 'identity',
    fullName: [d['firstName'], d['middleName'], d['lastName']].filter(Boolean).join(' '),
    email: text(d['email']),
    phone: text(d['phone']),
    birthDate: '',
    rg: '',
    cpf: text(d['ssn']),
    pis: '',
    cnpj: '',
    cnh: text(d['licenseNumber']),
    passport: text(d['passportNumber']),
    address: [d['address1'], d['address2'], d['address3']].filter(Boolean).join(', '),
    city: text(d['city']),
    state: text(d['state']),
    zip: text(d['postalCode']),
    country: text(d['country']),
    notes,
  };
}

/** Adapter for the nested JSON layout. */
export const jsonNested: ImportAdapter = {
  id: 'json-nested',

  // `items` is what makes it this layout; a `folders` list and numeric `type` on every item add certainty. A malformed entry still
  // selects this adapter, so parse() can say which entry is wrong instead of "unrecognized".
  detect(input) {
    if (!isObjectLike(input) || !isUnknownArray(input['items'])) return 0;
    const items = input['items'];
    const typed = items.length > 0 && items.every((item) => isObjectLike(item) && typeof item['type'] === 'number');
    return 0.6 + (isUnknownArray(input['folders']) ? 0.2 : 0) + (typed ? 0.2 : 0);
  },

  parse(input): ParseResult {
    const root: Readonly<Record<string, unknown>> = isObjectLike(input) ? input : {};
    const rawItems = root['items'];
    if (!isUnknownArray(rawItems)) throw coded('err.import.unrecognized', 'This file is not in a supported format.');

    const rawFolders = root['folders'] || [];
    if (!isUnknownArray(rawFolders)) throw coded('err.import.invalidEntry', 'Invalid entry in the file (folders).', { where: 'folders' });
    const folders = new Map<unknown, unknown>(
      rawFolders.map((f): [unknown, unknown] => {
        const folder = entry(f, 'folders');
        return [folder['id'], folder['name']];
      }),
    );
    const items: InterchangeItem[] = [];
    let ignored = 0;

    for (const rawItem of rawItems) {
      const it = entry(rawItem, 'items');
      if (it['deletedDate']) {
        ignored++;
        continue;
      }
      const common: Common = {
        name: text(it['name'], '(unnamed)'),
        folder: text(folders.get(it['folderId'])),
        favorite: Boolean(it['favorite']),
        createdAt: text(it['creationDate']) || undefined,
      };
      const extra = fieldsToText(it['fields']);
      const notes = [text(it['notes']), extra ? `Custom fields:\n${extra}` : ''].filter(Boolean).join('\n\n');

      if (it['type'] === TYPE_LOGIN) {
        const login = entry(it['login'] || {}, 'login');
        const rawUris = login['uris'] || [];
        if (!isUnknownArray(rawUris)) throw coded('err.import.invalidEntry', 'Invalid entry in the file (login uris).', { where: 'login uris' });
        items.push({
          ...common,
          type: 'login',
          username: text(login['username']),
          password: text(login['password']),
          totp: text(login['totp']),
          uris: rawUris.map((u) => (isObjectLike(u) ? u['uri'] : undefined)).filter((u) => typeof u === 'string' && u !== '').map(String),
          notes,
        });
      } else if (it['type'] === TYPE_NOTE) {
        items.push({ ...common, type: 'note', notes });
      } else if (it['type'] === TYPE_IDENTITY && it['identity']) {
        items.push(identityItem(common, entry(it['identity'], 'identity'), notes));
      } else if (it['type'] === TYPE_CARD) {
        const card = entry(it['card'] || {}, 'card');
        // The vault has no brand field, so it is kept in the notes.
        const brand = text(card['brand']);
        items.push({
          ...common,
          type: 'card',
          cardholder: text(card['cardholderName']),
          cardNumber: text(card['number']),
          cardExpiry: cardExpiry(card['expMonth'], card['expYear']),
          cardCvv: text(card['code']),
          notes: [brand ? `brand: ${brand}` : '', notes].filter(Boolean).join('\n\n'),
        });
      } else {
        ignored++;
      }
    }
    return { items, ignored, warnings: [] };
  },
};
