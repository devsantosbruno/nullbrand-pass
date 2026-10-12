// Primitivas criptográficas do voltrama-pass.
// Somente módulos nativos do Node: scrypt (KDF) + AES-256-GCM (cifra autenticada).
import { scrypt, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

// Parâmetros padrão do scrypt (~128 MiB de memória, ~0,5 s em uma CPU comum).
export const DEFAULT_KDF = Object.freeze({ name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32 });

export function deriveKey(password, kdf) {
  if (typeof password !== 'string' || password.length === 0) {
    return Promise.reject(new Error('Senha mestra vazia.'));
  }
  if (kdf.name !== 'scrypt') {
    return Promise.reject(new Error(`KDF não suportada: ${kdf.name}`));
  }
  const salt = Buffer.from(kdf.salt, 'base64');
  const maxmem = 128 * kdf.N * kdf.r * 2 + 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, kdf.keyLen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export function newKdfParams() {
  return { ...DEFAULT_KDF, salt: randomBytes(16).toString('base64') };
}

// Cifra um objeto JSON. "aad" amarra o texto cifrado ao cabeçalho do arquivo.
export function encryptJson(key, value, aad = '') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptJson(key, box, aad = '') {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  try {
    const plain = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw new WrongPasswordError();
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Senha mestra incorreta ou cofre corrompido.');
    this.code = 'WRONG_PASSWORD';
  }
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
