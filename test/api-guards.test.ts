import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guardExportResponse,
  guardImportPreviewResponse,
  guardImportResponse,
  guardClipboardCopyResponse,
  guardConfigResponse,
  guardCountResponse,
  guardDict,
  guardFolderDeleteResponse,
  guardFolderList,
  guardFolderNameResponse,
  guardGenerateResponse,
  guardMergeResponse,
  guardOkResponse,
  guardPublicItems,
  guardShutdownAck,
  guardSshKeyResponse,
  guardStatusResponse,
  guardVaultItem,
  isApiErrorResponse,
  isPublicItem,
} from '../src/shared/api-guards.js';
import type { Guard } from '../src/shared/api-guards.js';
import { normalizeItem } from '../src/vault.js';
import type { VaultItem } from '../src/shared/vault-types.js';
import { at, readDictFile } from './support.js';

const SENTINEL = 'SENTINEL-s3cr3t-value';
const LEAK = /SENTINEL|424242/;

function refused(guard: Guard<unknown>, value: unknown, label: string): string {
  const result = guard(value);
  if (result.ok) assert.fail(`${label}: the guard accepted a value it must refuse`);
  assert.doesNotMatch(result.reason, LEAK, `${label}: the reason echoes a value`);
  assert.ok(result.reason.length > 0, `${label}: empty reason`);
  return result.reason;
}

function accepted<T>(guard: Guard<T>, value: unknown, label: string): T {
  const result = guard(value);
  if (!result.ok) assert.fail(`${label}: refused (${result.reason})`);
  assert.equal(result.value, value, `${label}: not the same value`);
  return result.value;
}

const WRONG_VALUES: readonly unknown[] = [SENTINEL, 424242, { leak: SENTINEL }, [SENTINEL], false, null];
const NOT_OBJECTS: readonly unknown[] = [null, undefined, SENTINEL, 424242, true, [], [SENTINEL]];

interface Case {
  name: string;
  guard: Guard<unknown>;
  valid: Readonly<Record<string, unknown>>;
}
const CASES: readonly Case[] = [
  { name: 'guardOkResponse', guard: guardOkResponse, valid: { ok: true } },
  { name: 'guardCountResponse', guard: guardCountResponse, valid: { ok: true, count: 3 } },
  { name: 'guardFolderDeleteResponse', guard: guardFolderDeleteResponse, valid: { ok: true, count: 0 } },
  {
    name: 'guardStatusResponse',
    guard: guardStatusResponse,
    valid: { exists: true, unlocked: false, vaultPath: '/tmp/vault.json', idleMinutes: 15, count: null, lang: 'en', langSource: 'flag' },
  },
  { name: 'guardConfigResponse', guard: guardConfigResponse, valid: { lang: 'pt', source: 'config', supported: ['en', 'pt'] } },
  { name: 'guardFolderNameResponse', guard: guardFolderNameResponse, valid: { name: 'Work' } },
  {
    name: 'guardSshKeyResponse',
    guard: guardSshKeyResponse,
    valid: { algo: 'ed25519', publicKey: 'ssh-ed25519 AAAA', fingerprint: 'SHA256:abc', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----' },
  },
  { name: 'guardClipboardCopyResponse', guard: guardClipboardCopyResponse, valid: { ok: true, seconds: 30 } },
  { name: 'guardGenerateResponse', guard: guardGenerateResponse, valid: { password: 'p4ss-w0rd', bits: 118.5 } },
  { name: 'guardMergeResponse', guard: guardMergeResponse, valid: { added: 1, skipped: 2 } },
  { name: 'guardImportResponse', guard: guardImportResponse, valid: { added: 1, skipped: 2, ignored: 3, warnings: [{ key: 'import.warn.rowShape', params: { count: 1 } }] } },
  { name: 'guardImportPreviewResponse', guard: guardImportPreviewResponse, valid: { count: 2, ignored: 0, warnings: [] } },
  { name: 'guardExportResponse', guard: guardExportResponse, valid: { filename: 'x.json', mime: 'application/json', text: '{}', warnings: [{ key: 'export.warn.sshAsNote', params: { name: 'k' } }] } },
];

for (const { name, guard, valid } of CASES) {
  test(`${name}: accepts the valid answer (same object, extra fields allowed) and refuses everything else without echoing values`, () => {
    accepted(guard, valid, 'valid');
    accepted(guard, { ...valid, futureField: SENTINEL }, 'with an extra field');

    for (const bad of NOT_OBJECTS) assert.match(refused(guard, bad, `not an object (${typeof bad})`), /expected object/);

    for (const key of Object.keys(valid)) {
      const { [key]: _gone, ...without } = valid;
      assert.match(refused(guard, without, `missing "${key}"`), new RegExp(`\\.${key}\\b`), `missing "${key}" must name the field`);
      let refusedOne = false;
      for (const bad of WRONG_VALUES) {
        const answer = { ...valid, [key]: bad };
        if (guard(answer).ok) continue;
        refusedOne = true;
        assert.match(refused(guard, answer, `"${key}" = ${typeof bad}`), new RegExp(`\\.${key}\\b`), `a wrong "${key}" must name the field`);
      }
      assert.ok(refusedOne, `no wrong value was refused for "${key}"`);
    }
  });
}

test('guards read own properties only: an inherited field does not count', () => {
  assert.match(refused(guardOkResponse, Object.create({ ok: true }), 'inherited ok'), /\.ok\b/);
  assert.match(refused(guardFolderNameResponse, Object.create({ name: 'Work' }), 'inherited name'), /\.name\b/);
});

test('guardStatusResponse: `count` is a number or null, `lang` and `langSource` come from the closed sets', () => {
  const base = { exists: true, unlocked: true, vaultPath: 'p', idleMinutes: 0, lang: 'pt', langSource: 'system' };
  accepted(guardStatusResponse, { ...base, count: 0 }, 'count 0');
  accepted(guardStatusResponse, { ...base, count: null }, 'count null');
  for (const langSource of ['flag', 'env', 'config', 'system', 'default']) accepted(guardStatusResponse, { ...base, count: 1, langSource }, langSource);
  refused(guardStatusResponse, { ...base, count: 1, lang: 'fr' }, 'unsupported lang');
  refused(guardStatusResponse, { ...base, count: 1, langSource: 'cookie' }, 'unknown source');
  refused(guardStatusResponse, { ...base, count: undefined }, 'count undefined');
});

test('guardConfigResponse: `supported` must be an array of supported languages', () => {
  const base = { lang: 'en', source: 'default' };
  refused(guardConfigResponse, { ...base, supported: ['en', 'fr'] }, 'unsupported entry');
  refused(guardConfigResponse, { ...base, supported: 'en' }, 'string instead of array');
  accepted(guardConfigResponse, { ...base, supported: [] }, 'empty list');
});

test('guardSshKeyResponse: `algo` is one of the two algorithms; `comment` is optional but must be text when present', () => {
  const key = { publicKey: 'a', fingerprint: 'b', privateKey: 'c' };
  accepted(guardSshKeyResponse, { ...key, algo: 'rsa4096' }, 'rsa4096');
  accepted(guardSshKeyResponse, { ...key, algo: 'ed25519', comment: 'me@host' }, 'with comment');
  accepted(guardSshKeyResponse, { ...key, algo: 'ed25519', comment: undefined }, 'comment undefined');
  assert.match(refused(guardSshKeyResponse, { ...key, algo: 'ed25519', comment: 424242 }, 'comment number'), /\.comment\b/);
  refused(guardSshKeyResponse, { ...key, algo: 'dsa' }, 'unknown algorithm');
});

test('guardGenerateResponse: `bits: null` is NOT accepted', async () => {
  assert.match(refused(guardGenerateResponse, { password: 'x', bits: null }, 'bits null'), /\.bits\b/);
  refused(guardGenerateResponse, { password: 'x', bits: 'NaN' }, 'bits as text');
});

test('isApiErrorResponse: a string `error`, an optional string `key`, optional flat `params`', () => {
  assert.ok(isApiErrorResponse({ error: 'Vault locked.' }));
  assert.ok(isApiErrorResponse({ error: 'x', key: 'err.http.locked' }));
  assert.ok(isApiErrorResponse({ error: 'x', key: 'err.x', params: { n: 1, s: 'a', b: true, nothing: null, gone: undefined } }));
  assert.ok(isApiErrorResponse({ error: 'x', key: undefined, params: undefined }), 'explicit undefined is the same as absent');
  assert.ok(isApiErrorResponse({ error: 'x', futureField: SENTINEL }));
  for (const bad of [null, undefined, 'error', 5, [], [{ error: 'x' }], {}, { key: 'err.x' }, { error: 5 }, { error: null }]) assert.ok(!isApiErrorResponse(bad), String(bad));
  assert.ok(!isApiErrorResponse({ error: 'x', key: 5 }));
  assert.ok(!isApiErrorResponse({ error: 'x', key: null }));
  assert.ok(!isApiErrorResponse({ error: 'x', params: 'a=1' }));
  assert.ok(!isApiErrorResponse({ error: 'x', params: [1] }));
  assert.ok(!isApiErrorResponse({ error: 'x', params: { nested: { a: 1 } } }));
});

function fullItems(): VaultItem[] {
  return [
    normalizeItem({ type: 'login', name: 'Bank', username: 'me', password: 'login-pw', uris: ['https://a', 'https://b'], totp: 'JBSWY3DP', notes: 'n', folder: 'F', favorite: true }),
    normalizeItem({ type: 'note', name: 'Memo', notes: 'text' }),
    normalizeItem({ type: 'card', name: 'Visa', cardholder: 'ME', cardNumber: '4111111111111111', cardExpiry: '12/30', cardCvv: '123' }),
    normalizeItem({ type: 'identity', name: 'Me', fullName: 'My Name', email: 'a@b.c', cpf: '123', country: 'BR' }),
    normalizeItem({ type: 'ssh', name: 'Server', sshAlgo: 'ed25519', sshPublicKey: 'ssh-ed25519 AAAA', sshFingerprint: 'SHA256:x', sshPrivateKey: 'PRIVATE', sshHost: 'h', sshUser: 'u', sshPort: '22' }),
  ];
}
function publicForm(item: VaultItem): Record<string, unknown> {
  const { password, totp, sshPrivateKey, ...rest } = item;
  return { ...rest, hasPassword: password !== '', hasTotp: totp !== '', hasSshKey: sshPrivateKey !== '' };
}

test('guardVaultItem: every type is accepted and the SAME object comes back, extra properties included', () => {
  for (const item of fullItems()) {
    accepted(guardVaultItem, item, item.type);
    const withExtra = { ...item, futureField: { nested: [1, 2] } };
    const result: Readonly<Record<string, unknown>> = accepted(guardVaultItem, withExtra, `${item.type} with extra field`);
    assert.deepEqual(result['futureField'], { nested: [1, 2] }, 'the extra property is still there');
    accepted(guardVaultItem, { ...item, createdAt: '' }, `${item.type} with an empty createdAt`);
  }
});

test('guardVaultItem: refuses malformed items and the reason names the field without echoing any value', () => {
  const login: Record<string, unknown> = { ...normalizeItem({ type: 'login', name: SENTINEL, username: SENTINEL, password: SENTINEL, totp: SENTINEL, notes: SENTINEL, folder: SENTINEL, uris: [SENTINEL] }) };
  accepted(guardVaultItem, login, 'sentinel login (valid)');
  for (const key of Object.keys(login)) {
    if (key === 'uris') continue;
    const reason = refused(guardVaultItem, { ...login, [key]: 424242 }, `${key} = number`);
    assert.match(reason, new RegExp(`\\.${key}\\b`), `${key}: the reason must name the field`);
  }
  assert.match(refused(guardVaultItem, { ...login, uris: [SENTINEL, 424242] }, 'uris with a number'), /\.uris\b/);
  assert.match(refused(guardVaultItem, { ...login, uris: SENTINEL }, 'uris as a string'), /\.uris\b/);
  assert.match(refused(guardVaultItem, { ...login, id: '' }, 'empty id'), /\.id\b/);
  assert.match(refused(guardVaultItem, { ...login, type: SENTINEL }, 'unknown type'), /\.type: expected one of login, note, card, identity, ssh/);
  assert.match(refused(guardVaultItem, { ...login, favorite: SENTINEL }, 'favorite as text'), /\.favorite\b/);
  for (const bad of NOT_OBJECTS) assert.match(refused(guardVaultItem, bad, `item = ${typeof bad}`), /expected object/);
});

test('guardVaultItem: a field that belongs to another type must be empty (a note cannot hold a password), and the secret is not echoed', () => {
  const note = normalizeItem({ type: 'note', name: 'Memo' });
  assert.match(refused(guardVaultItem, { ...note, password: SENTINEL }, 'note with a password'), /\.password: expected an empty string for a note item/);
  assert.match(refused(guardVaultItem, { ...note, uris: [SENTINEL] }, 'note with uris'), /\.uris: expected an empty array for a note item/);
  const login = normalizeItem({ type: 'login', name: 'x' });
  assert.match(refused(guardVaultItem, { ...login, cardNumber: SENTINEL }, 'login with a card number'), /\.cardNumber\b/);
  assert.match(refused(guardVaultItem, { ...login, sshPrivateKey: SENTINEL }, 'login with an ssh key'), /\.sshPrivateKey\b/);
});

test('isPublicItem: the list form carries the three flags instead of the secrets', () => {
  for (const item of fullItems()) {
    const pub = publicForm(item);
    assert.equal(isPublicItem(pub), true, item.type);
    assert.ok(isPublicItem({ ...pub, futureField: SENTINEL }), `${item.type} with an extra field`);
    assert.ok(!isPublicItem(item), `${item.type}: the full form has no hasPassword/hasTotp/hasSshKey flags`);
    for (const flag of ['hasPassword', 'hasTotp', 'hasSshKey']) {
      const { [flag]: _gone, ...without } = pub;
      assert.ok(!isPublicItem(without), `${item.type} without ${flag}`);
      assert.ok(!isPublicItem({ ...pub, [flag]: SENTINEL }), `${item.type} with ${flag} as text`);
    }
  }
});

test('guardPublicItems: the same entries come back in a new array; a bad entry is named by position, never by value', () => {
  const list = fullItems().map(publicForm);
  const result = guardPublicItems(list);
  if (!result.ok) assert.fail(result.reason);
  assert.notEqual(result.value, list, 'a new array');
  assert.equal(result.value.length, list.length);
  result.value.forEach((entry, i) => assert.equal(entry, list[i], `entry ${i} is the same object`));
  const empty = guardPublicItems([]);
  assert.ok(empty.ok && empty.value.length === 0);

  for (const bad of [null, undefined, SENTINEL, 424242, {}, { length: 1 }]) assert.match(refused(guardPublicItems, bad, `list = ${typeof bad}`), /^items: expected array$/);
  const broken = [...list.slice(0, 2), { ...at(list, 2), name: 424242, notes: SENTINEL }, ...list.slice(3)];
  assert.match(refused(guardPublicItems, broken, 'third entry broken'), /^items\[2\]\.name: expected string$/);
  assert.match(refused(guardPublicItems, [...list, null], 'null entry'), /^items\[5\]: expected object$/);
});

test('guardFolderList: returns a COPY (the UI edits its own list) and refuses anything that is not an array of strings', () => {
  const answer = ['Work', 'Personal'];
  const result = guardFolderList(answer);
  if (!result.ok) assert.fail(result.reason);
  assert.deepEqual(result.value, answer);
  assert.notEqual(result.value, answer, 'not the same array');
  result.value.push('Added by the UI');
  assert.deepEqual(answer, ['Work', 'Personal'], 'the answer was not touched');
  assert.deepEqual(guardFolderList([]), { ok: true, value: [] });
  for (const bad of [null, undefined, SENTINEL, 424242, {}, [SENTINEL, 424242], [null], [['x']]]) assert.equal(refused(guardFolderList, bad, `folders = ${JSON.stringify(bad)}`), 'folders: expected array of strings');
});

test('guardShutdownAck: `{ ok: true }` becomes `undefined` (the route is typed as having no body); anything else is refused', () => {
  assert.deepEqual(guardShutdownAck({ ok: true }), { ok: true, value: undefined });
  assert.deepEqual(guardShutdownAck({ ok: true, futureField: SENTINEL }), { ok: true, value: undefined });
  for (const bad of [{}, { ok: false }, { ok: 'true' }, { ok: SENTINEL }, null, undefined, 'ok', [], [true]]) assert.match(refused(guardShutdownAck, bad, JSON.stringify(bad)), /expected (object|true)/);
});

test('guardDict: an object of strings is accepted as is; an array, a non-object or a non-string entry is refused naming the KEY only', () => {
  const dict = { 'a.hello': 'Hello', 'a.bye': 'Bye' };
  assert.equal(accepted(guardDict, dict, 'dictionary'), dict);
  accepted(guardDict, {}, 'empty dictionary');
  for (const bad of [null, undefined, SENTINEL, 424242, [], [SENTINEL]]) assert.equal(refused(guardDict, bad, `dictionary = ${typeof bad}`), 'dictionary: expected object');
  assert.equal(refused(guardDict, { ...dict, 'a.broken': { leak: SENTINEL } }, 'object entry'), 'dictionary.a.broken: expected string');
  assert.equal(refused(guardDict, { ...dict, 'a.number': 424242 }, 'number entry'), 'dictionary.a.number: expected string');
  assert.equal(refused(guardDict, { 'a.null': null }, 'null entry'), 'dictionary.a.null: expected string');
});

test('guardDict accepts the two real dictionaries of the package', () => {
  for (const lang of ['en', 'pt']) {
    const dict = readDictFile(new URL(`../locales/${lang}.json`, import.meta.url));
    assert.ok(guardDict(dict).ok, lang);
  }
});
