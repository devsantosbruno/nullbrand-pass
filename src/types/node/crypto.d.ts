// Hand-written declarations for the parts of node:crypto nullbrand uses. Reference: Node.js 22.14.
// Docs: https://nodejs.org/docs/latest-v22.x/api/crypto.html
// `Observed:` = checked by hand on Node v22.14.0 (the reference version) where the docs are silent.
declare module "node:crypto" {
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback
  // Only the short option names are declared (the long aliases cost/blockSize/parallelization exist but are unused).
  interface ScryptOptions {
    N?: number; // CPU/memory cost, a power of two greater than one. Default 16384.
    r?: number; // block size. Default 8.
    p?: number; // parallelization. Default 1.
    maxmem?: number; // memory upper bound in bytes. Default 32 MiB. Needs roughly 128 * N * r.
  }
  // Docs: password and salt may be string | ArrayBuffer | Buffer | TypedArray | DataView (only Uint8Array is declared: the code passes Buffers).
  // Failure modes. Observed: invalid parameters (N not a power of two, a memory need above `maxmem`, p too large) make scrypt THROW
  // synchronously, a RangeError with code ERR_CRYPTO_INVALID_SCRYPT_PARAMS, and the callback is never called. The docs agree
  // ("an exception is thrown when any of the input arguments specify invalid values or types"). deriveKey calls scrypt inside the
  // executor of a `new Promise`, where a synchronous throw becomes a rejection, so both paths end in a rejected promise.
  // A failure while deriving, after the arguments were accepted, is delivered to the callback as `err` (an Error); the callback
  // is then called with `derivedKey` undefined. Observed: N=2**20, r=2**20, p=1, maxmem=Number.MAX_SAFE_INTEGER passes the
  // synchronous checks and calls back with `(Error: "Deriving bits failed", undefined)`; that Error has no `code` (plain Error).
  // Do not match on the message: it is not documented.
  // The callback is invoked asynchronously (never synchronously inside this call). The parameter list is a union of tuples so that
  // checking `err` narrows `derivedKey`: it is a Buffer only when `err` is null.
  function scrypt(
    password: Uint8Array,
    salt: Uint8Array,
    keylen: number,
    options: ScryptOptions,
    callback: (...args: [err: Error, derivedKey: undefined] | [err: null, derivedKey: Buffer]) => void,
  ): void;

  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptorandombytessize-callback  (synchronous form)
  // Docs: `size` must not be larger than 2**31 - 1; "an error will be thrown if there is a problem generating the bytes".
  // Observed: RangeError ERR_OUT_OF_RANGE for a size outside [0, 2**31 - 1].
  function randomBytes(size: number): Buffer;
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptorandomintmin-max-callback  (synchronous form, one-argument overload)
  // Returns an integer in [0, max). `min` defaults to 0. Docs: min and max must be safe integers and max - min must be less than 2**48.
  // Observed: RangeError ERR_OUT_OF_RANGE when max <= min (so randomInt(0) throws) or the range is too large; TypeError
  // ERR_INVALID_ARG_TYPE for a non-integer.
  function randomInt(max: number): number;
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptorandomuuidoptions  (the `options` argument is unused here)
  function randomUUID(): string;
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptotimingsafeequala-b
  // Observed: throws RangeError ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH when the inputs have different byte lengths: it does NOT return false.
  // Callers must compare lengths first or hash both sides to a fixed size.
  function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;

  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#class-hash
  interface Hash {
    // Returns the same Hash (chainable). A string is encoded as UTF-8 unless `inputEncoding` says otherwise (ignored for binary input).
    // Throws ERR_CRYPTO_HASH_FINALIZED if called after digest().
    update(data: string | Uint8Array): this;
    update(data: string, inputEncoding: BufferEncoding): this;
    // Without an encoding returns a Buffer; with one, a string. After digest() the Hash cannot be used again (ERR_CRYPTO_HASH_FINALIZED).
    digest(): Buffer;
    digest(encoding: "base64" | "hex"): string;
  }
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptocreatehashalgorithm-options
  // The docs accept any algorithm OpenSSL supports; only the one used here is declared. Throws "Digest method not supported" if unknown.
  function createHash(algorithm: "sha256"): Hash;

  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#class-cipher  (AES-GCM usage only)
  interface CipherGCM {
    // Returns the encrypted chunk as a Buffer (no outputEncoding given). A string is decoded with `inputEncoding`.
    // Throws if called after final().
    update(data: string, inputEncoding: "utf8"): Buffer;
    // Returns the remaining bytes (empty for GCM stream mode). Observed: calling it twice throws Error ERR_CRYPTO_INVALID_STATE.
    final(): Buffer;
    // Only valid AFTER final(); observed: calling it earlier throws Error ERR_CRYPTO_INVALID_STATE. Returns the 16-byte tag.
    getAuthTag(): Buffer;
    // Must be called BEFORE update(). Returns the same cipher.
    setAAD(buffer: Uint8Array): this;
  }
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options
  // Observed: throws RangeError ERR_CRYPTO_INVALID_KEYLEN for a key that is not 32 bytes. For GCM the IV should be 12 bytes.
  function createCipheriv(algorithm: "aes-256-gcm", key: Uint8Array, iv: Uint8Array): CipherGCM;

  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#class-decipher  (AES-GCM usage only)
  interface DecipherGCM {
    update(data: Uint8Array): Buffer;
    // For GCM this is where authentication happens: if the tag, the AAD, the key or the ciphertext do not match, it THROWS an Error
    // instead of returning. Observed in isolation: a plain Error without `code`, message "Unsupported state or unable to authenticate
    // data". Observed too: after other failed OpenSSL calls in the same process (scrypt with invalid params) the error came out with a
    // stale OpenSSL code and message (ERR_OSSL_EVP_MEMORY_LIMIT_EXCEEDED). So NEVER match on the message or code: any throw from
    // final() means "not authentic". (decryptJson turns every throw into WrongPasswordError.) Calling it twice: ERR_CRYPTO_INVALID_STATE.
    final(): Buffer;
    // Must be called BEFORE final(). Returns the same decipher.
    // Docs: throws if the tag length is invalid per NIST SP 800-38D or differs from the `authTagLength` given to createDecipheriv; and
    // (History v22.0.0) "using GCM tag lengths other than 128 bits without specifying authTagLength ... is deprecated".
    // SECURITY (fixed in src/crypto.ts: decryptJson passes `{ authTagLength: 16 }` and checks the length first): the deprecation is documentation only on 22.14. Observed: with no `authTagLength`, a TRUNCATED
    // tag is accepted and decrypts successfully (4 and 8 bytes, correct prefix) and NO warning is emitted; 3 bytes throws TypeError
    // ERR_CRYPTO_INVALID_AUTH_TAG; with `{ authTagLength: 16 }` a 4-byte tag is rejected with the same code.
    setAuthTag(buffer: Uint8Array): this;
    // Must be called BEFORE update(). Returns the same decipher.
    setAAD(buffer: Uint8Array): this;
  }
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptocreatedecipherivalgorithm-key-iv-options
  // `options` for GCM: `authTagLength` (bytes) is the only member used. The literal 16 is the only value the code passes.
  function createDecipheriv(algorithm: "aes-256-gcm", key: Uint8Array, iv: Uint8Array, options?: { authTagLength: 16 }): DecipherGCM;

  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#keyobjectexportoptions  (format: 'jwk', added v15.9.0)
  // Every member is optional: which ones are present depends on the key type (OKP: kty/crv/x/(d); RSA: kty/n/e/(d/p/q/dp/dq/qi)).
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
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#class-keyobject
  interface KeyObject {
    // Throws if the key type cannot be exported in that format.
    export(options: { format: "jwk" }): JsonWebKey;
    // https://nodejs.org/docs/latest-v22.x/api/crypto.html#keyobjectasymmetrickeytype
    // Docs: one of 'rsa' | 'rsa-pss' | 'dsa' | 'ec' | 'x25519' | 'x448' | 'ed25519' | 'ed448' | 'dh'; "undefined for unrecognized KeyObject
    // types and symmetric keys".
    readonly asymmetricKeyType: "rsa" | "rsa-pss" | "dsa" | "ec" | "x25519" | "x448" | "ed25519" | "ed448" | "dh" | undefined;
    // https://nodejs.org/docs/latest-v22.x/api/crypto.html#keyobjectasymmetrickeydetails
    // Docs: "exists only on asymmetric keys"; only `modulusLength` ("Key size in bits (RSA, DSA)") is declared, the only member read.
    // Observed: an Ed25519 private key has `{}` (no modulusLength); an RSA one has modulusLength and publicExponent (a bigint).
    readonly asymmetricKeyDetails: { readonly modulusLength?: number } | undefined;
  }
  interface KeyPairKeyObjectResult {
    publicKey: KeyObject;
    privateKey: KeyObject;
  }
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptogeneratekeypairsynctype-options
  // Without encoding options the result holds KeyObjects. Throws on invalid options; RSA 4096 can take a noticeable time.
  function generateKeyPairSync(type: "ed25519"): KeyPairKeyObjectResult;
  function generateKeyPairSync(type: "rsa", options: { modulusLength: number }): KeyPairKeyObjectResult;
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptocreateprivatekeykey
  // A string is parsed as PEM (the docs also accept a Buffer; no call site passes one, so it is not declared). Throws on malformed or
  // ENCRYPTED PEM without a passphrase (ERR_MISSING_PASSPHRASE) and on an unsupported key. The `{ key, format: 'jwk' }` form is the
  // one used to rebuild keys from OpenSSH parts.
  function createPrivateKey(key: string | { key: JsonWebKey; format: "jwk" }): KeyObject;
}
