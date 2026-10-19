// Spec 04 — the one import flow: detection, the folder options, the limits and hostile input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_IMPORT_BYTES, parseImport, planImport } from '../src/formats/index.js';
import { pickAdapter } from '../src/formats/detect.js';
import { applyFolderPolicy } from '../src/formats/folders.js';
import type { ImportAdapter, InterchangeItem } from '../src/formats/types.js';
import { normalizeItem } from '../src/vault.js';
import { at, thrownKey } from './support.js';

const NESTED = JSON.stringify({
  encrypted: false,
  folders: [{ id: 'f1', name: 'Work' }],
  items: [{ type: 1, name: 'Email', folderId: 'f1', login: { username: 'u', password: 'p', uris: [{ uri: 'https://mail.com' }] } }],
});

const keyOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return thrownKey(e);
  }
  return undefined;
};
const login = (item: InterchangeItem | undefined) => {
  if (item?.type !== 'login') assert.fail('expected a login');
  return item;
};

// ---- detection ----

test('detect: the layout is recognised without being told which it is; a BOM and leading blanks do not hide it', () => {
  assert.equal(planImport(NESTED).items.length, 1);
  assert.equal(planImport('﻿  \n' + NESTED).items.length, 1);
});

test('detect: near misses are unrecognised, never guessed', () => {
  for (const text of ['{"items": "not a list"}', '{"folders": []}', '[]', '{}', '42', 'null']) {
    assert.equal(keyOf(() => planImport(text)), 'err.import.unrecognized', text);
  }
  for (const text of ['', 'just some text', 'name,password\nx,y']) assert.equal(keyOf(() => planImport(text)), 'err.import.notJson', JSON.stringify(text));
});

test('detect: a tie between two adapters that are not certain fails; a certain one or a clear winner passes', () => {
  const adapter = (id: string, score: number): ImportAdapter => ({ id, detect: () => score, parse: () => ({ items: [], ignored: 0, warnings: [] }) });
  assert.equal(keyOf(() => pickAdapter([adapter('a', 0.7), adapter('b', 0.7)], null)), 'err.import.unrecognized');
  assert.equal(pickAdapter([adapter('a', 0.7), adapter('b', 0.6)], null).id, 'a');
  assert.equal(pickAdapter([adapter('a', 1), adapter('b', 1)], null).id, 'a');
  assert.equal(keyOf(() => pickAdapter([adapter('a', 0.4)], null)), 'err.import.unrecognized');
});

test('detect: an encrypted foreign export and a nullbrand backup get their own message', () => {
  assert.equal(keyOf(() => planImport(JSON.stringify({ encrypted: true, data: 'x' }))), 'err.import.encryptedForeign');
  assert.equal(keyOf(() => planImport(JSON.stringify({ format: 'nullbrand-vault', version: 2 }))), 'err.import.nativeBackup');
});

// ---- folders ----

const sample = (folder: string): InterchangeItem => ({ type: 'note', name: 'n', folder, favorite: false, createdAt: undefined, notes: '' });
const placed = (folder: string, policy: Parameters<typeof applyFolderPolicy>[1]) => at(applyFolderPolicy([sample(folder)], policy).items, 0).folder;

test('folders: the four combinations of destination and "folders from the file"', () => {
  assert.equal(placed('Work', { keepFolders: true }), 'Work', 'no destination + keep: as in the file');
  assert.equal(placed('', { keepFolders: true }), '', 'no destination + keep: no folder stays none');
  assert.equal(placed('Work', { destination: 'Dest', keepFolders: true }), 'Dest/Work', 'destination + keep: a prefix');
  assert.equal(placed('', { destination: 'Dest', keepFolders: true }), 'Dest', 'destination + keep: no folder goes straight into it');
  assert.equal(placed('Work', { destination: 'Dest', keepFolders: false }), 'Dest', 'destination + ignore: everything in it');
  assert.equal(placed('Work', { keepFolders: false }), '', 'no destination + ignore: no folders at all');
});

test('folders: a destination that differs only by case reuses the existing spelling; a long name warns', () => {
  assert.equal(placed('', { destination: ' work ', keepFolders: true, existing: ['Work'] }), 'Work');
  const long = applyFolderPolicy([sample('x'.repeat(200))], { destination: 'Dest', keepFolders: true });
  assert.deepEqual(long.warnings.map((w) => w.key), ['import.warn.folderTruncated']);
  assert.equal(normalizeItem({ ...at(long.items, 0) }).folder.length, 200, 'the vault cuts it');
});

test('folders: they apply to a parsed file through the options', () => {
  assert.equal(at(planImport(NESTED, { folder: 'Imported' }).items, 0).folder, 'Imported/Work');
  assert.equal(at(planImport(NESTED, { folder: 'Imported', ignoreFolders: true }).items, 0).folder, 'Imported');
});

// ---- limits and hostile input ----

test('limits: a file over 25 MiB is refused before it is parsed', () => {
  assert.equal(keyOf(() => parseImport('a'.repeat(MAX_IMPORT_BYTES + 1))), 'err.import.tooLarge');
});

test('hostile input: malformed JSON and deeply nested JSON are refused, not a crash', () => {
  assert.equal(keyOf(() => planImport('{"items": [')), 'err.import.notJson');
  const deep = '['.repeat(200_000) + ']'.repeat(200_000);
  assert.ok(['err.import.unrecognized', 'err.import.notJson'].includes(keyOf(() => planImport(deep)) ?? ''));
});

test('hostile input: prototype keys in the file never reach Object.prototype, and do not become item fields', () => {
  const json = '{"__proto__": {"polluted": true}, "folders": [{"id": "__proto__", "name": "Evil"}], "items": [{"type": 1, "name": "x", "__proto__": {"polluted": true}, "folderId": "__proto__", "login": {"__proto__": {"password": "p"}, "username": "u"}}]}';
  const { items } = planImport(json);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  assert.equal(Object.hasOwn({}, 'polluted'), false);
  const item = login(items[0]);
  assert.deepEqual([item.username, item.password, item.folder], ['u', '', 'Evil']);
  assert.equal(Object.hasOwn(item, 'polluted'), false);
});

test('a card, an identity and a login in the nested layout all come out as the right type', () => {
  const { items } = planImport(
    JSON.stringify({
      items: [
        { type: 3, name: 'Visa', card: { cardholderName: 'J DOE', number: '4111111111111111', expMonth: '3', expYear: '2030', code: '123', brand: 'Visa' } },
        { type: 4, name: 'Me', identity: { firstName: 'Jane', lastName: 'Doe', ssn: '123', licenseNumber: '456', passportNumber: 'X1', address1: 'Street 1', postalCode: '01000' } },
      ],
    }),
  );
  const card = at(items, 0);
  if (card.type !== 'card') assert.fail('card');
  assert.deepEqual([card.cardholder, card.cardNumber, card.cardExpiry, card.cardCvv, card.notes], ['J DOE', '4111111111111111', '03/2030', '123', 'brand: Visa']);
  const person = at(items, 1);
  if (person.type !== 'identity') assert.fail('identity');
  assert.deepEqual([person.fullName, person.cpf, person.cnh, person.passport, person.address, person.zip], ['Jane Doe', '123', '456', 'X1', 'Street 1', '01000']);
});

// ---- a real export file ----

test('fixture nested.json: both logins come in, with and without a folder, and the dates are kept', () => {
  const plan = planImport(readFileSync(new URL('./fixtures/nested.json', import.meta.url), 'utf8'));
  assert.deepEqual([plan.items.length, plan.ignored, plan.warnings], [2, 0, []]);
  const [withFolder, without] = plan.items.map(login);
  assert.deepEqual([withFolder?.name, withFolder?.folder, withFolder?.username, withFolder?.password, withFolder?.createdAt], ['Teste', 'pasta teste', 'testeee', 'senha teste', '2026-10-19T01:13:19.433Z']);
  assert.deepEqual([without?.name, without?.folder, without?.uris], ['teste sem pasta', '', []]);
});
