// How an SSH key pair is written out (src/web/ssh-format.ts): names, the ~/.ssh/config entry and the hand-written .zip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SSH_ALGOS, sshConfig, sshFileName, sshKeyPairFiles, sshPubLine, sshSlug, zipParts } from '../src/web/ssh-format.js';
import { at } from './support.js';

test('ssh names: slug and key file name', () => {
  assert.equal(sshSlug('Prod box'), 'prod-box');
  assert.equal(sshSlug('Servidor São Paulo #1'), 'servidor-sao-paulo-1');
  assert.equal(sshSlug('  ---  '), 'server', 'nothing left after cleaning falls back to "server"');
  assert.equal(sshFileName('Prod box', 'ed25519'), 'id_ed25519_prod-box');
  assert.equal(sshFileName('Prod box', 'rsa4096'), 'id_rsa_prod-box');
  assert.equal(SSH_ALGOS['ed25519'], 'Ed25519');
  assert.equal(sshPubLine('ssh-ed25519 AAAA', 'me@laptop'), 'ssh-ed25519 AAAA me@laptop');
  assert.equal(sshPubLine('ssh-ed25519 AAAA', ''), 'ssh-ed25519 AAAA');
});

test('ssh config entry: only the fields that are set; the default port is left out', () => {
  assert.equal(
    sshConfig({ name: 'Prod box', sshAlgo: 'ed25519', sshHost: 'prod.example.com', sshUser: 'ubuntu', sshPort: '2222' }),
    'Host prod-box\n  HostName prod.example.com\n  User ubuntu\n  Port 2222\n  IdentityFile ~/.ssh/id_ed25519_prod-box\n  IdentitiesOnly yes',
  );
  assert.equal(sshConfig({ name: 'x', sshHost: 'h', sshPort: '22' }), 'Host x\n  HostName h\n  IdentityFile ~/.ssh/id_ed25519_x\n  IdentitiesOnly yes');
  assert.equal(sshConfig({}), 'Host server\n  IdentityFile ~/.ssh/id_ed25519_server\n  IdentitiesOnly yes');
});

test('key pair files: private 600, public 644 (only when there is one), both end with a newline', () => {
  const both = sshKeyPairFiles({ name: 'Prod box', algo: 'ed25519', privateKey: 'PRIV', publicKey: 'ssh-ed25519 AAAA me\n' });
  assert.equal(both.base, 'id_ed25519_prod-box');
  assert.deepEqual(both.files, [
    { name: 'id_ed25519_prod-box', text: 'PRIV\n', mode: 0o600 },
    { name: 'id_ed25519_prod-box.pub', text: 'ssh-ed25519 AAAA me\n', mode: 0o644 },
  ]);
  assert.equal(sshKeyPairFiles({ name: 'x', algo: 'rsa4096', privateKey: 'P', publicKey: '' }).files.length, 1);
});

// Reads the archive back with the layout of the ZIP spec (APPNOTE 4.3), so the test checks the format and not the writer.
function readZip(bytes: Uint8Array): { name: string; text: string; mode: number; crc: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.byteLength - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(eocd + 12, true), eocd - cdOffset, 'central directory size');
  const dec = new TextDecoder();
  const entries: { name: string; text: string; mode: number; crc: number }[] = [];
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    assert.equal(view.getUint32(p, true), 0x02014b50, 'central header');
    assert.equal(view.getUint16(p + 4, true) >> 8, 3, 'made by Unix: the mode is honoured');
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const mode = (view.getUint32(p + 38, true) >>> 16) & 0o7777;
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(view.getUint32(local, true), 0x04034b50, 'local header');
    assert.equal(view.getUint16(local + 8, true), 0, 'stored (no compression)');
    const localNameLen = view.getUint16(local + 26, true);
    const data = bytes.subarray(local + 30 + localNameLen, local + 30 + localNameLen + size);
    entries.push({ name, text: dec.decode(data), mode, crc });
    p += 46 + nameLen;
  }
  return entries;
}
const join = (parts: readonly (DataView | Uint8Array)[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at0 = 0;
  for (const part of parts) {
    out.set(part instanceof DataView ? new Uint8Array(part.buffer, part.byteOffset, part.byteLength) : part, at0);
    at0 += part.byteLength;
  }
  return out;
};

test('zip: the archive reads back with the names, contents and Unix modes it was given', () => {
  const files = [{ name: 'id_ed25519_x', text: '-----BEGIN-----\nsecret\n', mode: 0o600 }, { name: 'id_ed25519_x.pub', text: 'ssh-ed25519 AAAA\n', mode: 0o644 }];
  const entries = readZip(join(zipParts(files, new Date(2026, 9, 19, 12, 30, 40))));
  assert.deepEqual(entries.map((e) => [e.name, e.text, e.mode]), files.map((f) => [f.name, f.text, f.mode]));
  // CRC-32 of "123456789" is the well-known check value 0xCBF43926.
  assert.equal(at(readZip(join(zipParts([{ name: 'c', text: '123456789', mode: 0o644 }]))), 0).crc, 0xcbf43926);
});
