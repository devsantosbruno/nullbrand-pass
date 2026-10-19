// Hand-written typings for the subset of node:crypto nullbrand uses, so the project needs no @types/node.
declare module "node:crypto" {
  interface ScryptOptions {
    N?: number;
    r?: number;
    p?: number;
    maxmem?: number;
  }
  function scrypt(
    password: Uint8Array,
    salt: Uint8Array,
    keylen: number,
    options: ScryptOptions,
    callback: (...args: [err: Error, derivedKey: undefined] | [err: null, derivedKey: Buffer]) => void,
  ): void;

  function randomBytes(size: number): Buffer;
  function randomInt(max: number): number;
  function randomUUID(): string;
  function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;

  interface Hash {
    update(data: string | Uint8Array): this;
    update(data: string, inputEncoding: BufferEncoding): this;
    digest(): Buffer;
    digest(encoding: "base64" | "hex"): string;
  }
  function createHash(algorithm: "sha256"): Hash;

  interface CipherGCM {
    update(data: string, inputEncoding: "utf8"): Buffer;
    final(): Buffer;
    getAuthTag(): Buffer;
    setAAD(buffer: Uint8Array): this;
  }
  function createCipheriv(algorithm: "aes-256-gcm", key: Uint8Array, iv: Uint8Array): CipherGCM;

  interface DecipherGCM {
    update(data: Uint8Array): Buffer;
    final(): Buffer;
    setAuthTag(buffer: Uint8Array): this;
    setAAD(buffer: Uint8Array): this;
  }
  function createDecipheriv(algorithm: "aes-256-gcm", key: Uint8Array, iv: Uint8Array, options?: { authTagLength: 16 }): DecipherGCM;

  interface JsonWebKey {
    kty?: string;
    crv?: string;
    x?: string;
    d?: string;
    n?: string;
    e?: string;
    p?: string;
    q?: string;
    dp?: string;
    dq?: string;
    qi?: string;
  }
  interface KeyObject {
    export(options: { format: "jwk" }): JsonWebKey;
    readonly asymmetricKeyType: "rsa" | "rsa-pss" | "dsa" | "ec" | "x25519" | "x448" | "ed25519" | "ed448" | "dh" | undefined;
    readonly asymmetricKeyDetails: { readonly modulusLength?: number } | undefined;
  }
  interface KeyPairKeyObjectResult {
    publicKey: KeyObject;
    privateKey: KeyObject;
  }
  function generateKeyPairSync(type: "ed25519"): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: "rsa", options: { modulusLength: number }): KeyPairKeyObjectResult;
  function createPrivateKey(key: string | { key: JsonWebKey; format: "jwk" }): KeyObject;
}
