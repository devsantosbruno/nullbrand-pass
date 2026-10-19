// SSH key generation and inspection (Ed25519 and RSA 4096) on Node built-ins only.
import { coded } from './errors.js';
import { isObjectLike } from './shared/guards.js';
import { generateKeyPairSync, createPrivateKey, createHash, randomBytes, type JsonWebKey, type KeyObject } from 'node:crypto';

/** Supported algorithms, mapped to their display names. */
export const SSH_ALGOS = { ed25519: 'Ed25519', rsa4096: 'RSA 4096' } as const;
export type SshAlgo = keyof typeof SSH_ALGOS;

/** A key as stored in an item. `privateKey` is empty when only a public key was given. */
export interface SshKeyInfo {
  readonly algo: SshAlgo;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly privateKey: string;
}
/** An {@link SshKeyInfo} plus the comment found in the key. */
export interface InspectedSshKey extends SshKeyInfo {
  readonly comment: string;
}

const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const sshString = (buf: Buffer): Buffer => Buffer.concat([u32(buf.length), buf]);
// SSH mpint: big-endian, with a leading 0 byte when the high bit is set.
const sshMpint = (buf: Buffer): Buffer => {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;
  const b = buf.subarray(i);
  return sshString((b[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
};
const b64url = (s: string): Buffer => Buffer.from(s, 'base64url');

// The JWK of a generated or parsed key carries these members; a missing one is reported rather than failing later.
type JwkMember = 'x' | 'd' | 'n' | 'e' | 'p' | 'q' | 'qi';
function jwkBytes(jwk: JsonWebKey, member: JwkMember): Buffer {
  const value = jwk[member];
  if (value === undefined) throw coded('err.ssh.invalidKey', 'Invalid private key or unsupported format.');
  return b64url(value);
}

function publicBlob(jwk: JsonWebKey): Buffer {
  if (jwk.kty === 'OKP') return Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(jwkBytes(jwk, 'x'))]);
  return Buffer.concat([sshString(Buffer.from('ssh-rsa')), sshMpint(jwkBytes(jwk, 'e')), sshMpint(jwkBytes(jwk, 'n'))]);
}

// Private key in OpenSSH format without a passphrase, as `ssh-keygen` writes it.
function openSshPrivate(jwk: JsonWebKey, blob: Buffer): string {
  const check = randomBytes(4);
  const parts = [check, check];
  if (jwk.kty === 'OKP') {
    const pub = jwkBytes(jwk, 'x');
    parts.push(sshString(Buffer.from('ssh-ed25519')), sshString(pub), sshString(Buffer.concat([jwkBytes(jwk, 'd'), pub])));
  } else {
    parts.push(
      sshString(Buffer.from('ssh-rsa')), sshMpint(jwkBytes(jwk, 'n')), sshMpint(jwkBytes(jwk, 'e')),
      sshMpint(jwkBytes(jwk, 'd')), sshMpint(jwkBytes(jwk, 'qi')), sshMpint(jwkBytes(jwk, 'p')), sshMpint(jwkBytes(jwk, 'q')),
    );
  }
  // Empty embedded comment.
  parts.push(sshString(Buffer.alloc(0)));
  let priv = Buffer.concat(parts);
  const pad = (8 - (priv.length % 8)) % 8;
  priv = Buffer.concat([priv, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    sshString(Buffer.from('none')), sshString(Buffer.from('none')), sshString(Buffer.alloc(0)),
    u32(1), sshString(blob), sshString(priv),
  ]);
  const wrapped = body.toString('base64').match(/.{1,70}/g);
  if (wrapped === null) throw coded('err.ssh.invalidKey', 'Invalid private key or unsupported format.');
  const lines = wrapped.join('\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function describe(privateKey: KeyObject, algo: SshAlgo): SshKeyInfo {
  const jwk = privateKey.export({ format: 'jwk' });
  const blob = publicBlob(jwk);
  const type = jwk.kty === 'OKP' ? 'ssh-ed25519' : 'ssh-rsa';
  return {
    algo,
    publicKey: `${type} ${blob.toString('base64')}`,
    fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`,
    privateKey: openSshPrivate(jwk, blob),
  };
}

/**
 * Generates a key pair. Nothing is stored.
 * @param algo `ed25519` or `rsa4096`.
 * @throws coded `err.ssh.invalidAlgo` for any other value.
 */
export function generateSshKey(algo: string): SshKeyInfo {
  if (algo === 'ed25519') return describe(generateKeyPairSync('ed25519').privateKey, 'ed25519');
  if (algo === 'rsa4096') return describe(generateKeyPairSync('rsa', { modulusLength: 4096 }).privateKey, 'rsa4096');
  throw coded('err.ssh.invalidAlgo', 'Invalid algorithm. Use Ed25519 or RSA 4096.');
}

// A public key line (.pub) can only be identified and stored, since there is no private key.
function inspectPublicLine(line: string): InspectedSshKey {
  const [type, b64, ...rest] = line.split(/\s+/);
  // The caller's regex guarantees both exist; this narrows the types.
  if (type === undefined || b64 === undefined) throw coded('err.ssh.invalidKey', 'Invalid private key or unsupported format.');
  const blob = Buffer.from(b64, 'base64');
  let algo: SshAlgo;
  if (type === 'ssh-ed25519') algo = 'ed25519';
  else if (type === 'ssh-rsa') {
    let o = 4 + blob.readUInt32BE(0);
    o += 4 + blob.readUInt32BE(o);
    const len = blob.readUInt32BE(o);
    if ((len - (blob[o + 4] === 0 ? 1 : 0)) * 8 !== 4096) throw coded('err.ssh.only4096', 'Only 4096-bit RSA keys are supported.');
    algo = 'rsa4096';
  } else throw coded('err.ssh.unsupportedType', 'Only Ed25519 and RSA 4096 keys are supported.');
  return {
    algo,
    publicKey: `${type} ${b64}`,
    fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`,
    privateKey: '',
    comment: rest.join(' '),
  };
}

/**
 * Parses a pasted private key (OpenSSH or PEM) or a public key line and derives its public key, fingerprint and comment.
 * @throws coded `err.ssh.*` for an empty, passphrase-protected, malformed or unsupported key.
 */
export function inspectSshKey(text: string): InspectedSshKey {
  const raw = String(text || '').trim();
  if (!raw) throw coded('err.ssh.pasteKey', 'Paste the private key.');
  if (/^(ssh-(ed25519|rsa)|ecdsa-sha2-\S+) AAAA/.test(raw)) return inspectPublicLine(raw);
  if (/ENCRYPTED/.test(raw) || /Proc-Type:.*ENCRYPTED/.test(raw)) throw coded('err.ssh.passphrase', 'Passphrase-protected keys are not supported. Remove the passphrase first (ssh-keygen -p -N "").');
  let key: KeyObject;
  let comment = '';
  try {
    if (raw.includes('OPENSSH PRIVATE KEY')) ({ key, comment } = fromOpenSsh(raw));
    else key = createPrivateKey(raw);
  } catch (err) {
    throw isObjectLike(err) && err['key'] === 'err.ssh.passphrase' ? err : coded('err.ssh.invalidKey', 'Invalid private key or unsupported format.');
  }
  const type = key.asymmetricKeyType;
  if (type === 'ed25519') return { ...describe(key, 'ed25519'), comment };
  if (type === 'rsa') {
    const details = key.asymmetricKeyDetails;
    if (details === undefined) throw coded('err.ssh.invalidKey', 'Invalid private key or unsupported format.');
    if (details.modulusLength !== 4096) throw coded('err.ssh.only4096', 'Only 4096-bit RSA keys are supported.');
    return { ...describe(key, 'rsa4096'), comment };
  }
  throw coded('err.ssh.unsupportedType', 'Only Ed25519 and RSA 4096 keys are supported.');
}

// Rebuilds a KeyObject, through JWK, from the fields of the OpenSSH private block.
function fromOpenSsh(text: string): { key: KeyObject; comment: string } {
  const m = text.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/);
  const body = m?.[1];
  if (!m || body === undefined) throw coded('err.ssh.invalidOpenssh', 'Invalid OpenSSH format.');
  const buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  const magic = 'openssh-key-v1\0';
  if (buf.subarray(0, magic.length).toString('latin1') !== magic) throw coded('err.ssh.invalidOpenssh', 'Invalid OpenSSH format.');
  let o = magic.length;
  const rd = (): Buffer => { const n = buf.readUInt32BE(o); o += 4; const s = buf.subarray(o, o + n); o += n; return s; };
  const cipher = rd().toString(); rd(); rd();
  if (cipher !== 'none') throw coded('err.ssh.passphrase', 'Passphrase-protected keys are not supported. Remove the passphrase first (ssh-keygen -p -N "").');
  o += 4;
  rd();
  const priv = rd();
  let p = 8;
  const rp = (): Buffer => { const n = priv.readUInt32BE(p); p += 4; const s = priv.subarray(p, p + n); p += n; return s; };
  const b = (x: Buffer): string => x.toString('base64url');
  let comment = '';
  const type = rp().toString();
  if (type === 'ssh-ed25519') {
    const pub = rp();
    const secret = rp().subarray(0, 32);
    comment = rp().toString();
    return { key: createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b(pub), d: b(secret) }, format: 'jwk' }), comment };
  }
  if (type === 'ssh-rsa') {
    const n = rp(), e = rp(), d = rp(), iqmp = rp(), pr = rp(), q = rp();
    comment = rp().toString();
    // dp and dq are not in the OpenSSH format, so they are recomputed from p, q and d.
    const big = (x: Buffer): bigint => BigInt('0x' + (x.toString('hex') || '0'));
    const dP = big(d) % (big(pr) - 1n), dQ = big(d) % (big(q) - 1n);
    const hex = (v: bigint): Buffer => Buffer.from(v.toString(16).padStart(Math.ceil(v.toString(16).length / 2) * 2, '0'), 'hex');
    return { key: createPrivateKey({ key: { kty: 'RSA', n: b(n), e: b(e), d: b(d), p: b(pr), q: b(q), dp: b(hex(dP)), dq: b(hex(dQ)), qi: b(iqmp) }, format: 'jwk' }), comment };
  }
  throw coded('err.ssh.unsupportedType', 'Only Ed25519 and RSA 4096 keys are supported.');
}
