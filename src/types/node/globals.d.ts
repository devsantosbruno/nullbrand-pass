// Hand-written declarations for the Node.js globals nullbrand uses. Reference: Node.js 22.14 (the `engines` minimum).
// Docs: https://nodejs.org/docs/latest-v22.x/api/globals.html and https://nodejs.org/docs/latest-v22.x/api/process.html
// Only what the code uses is declared, and always in the narrowest form that is still true to the documentation.
// `Observed:` marks behaviour the documentation does not state and that was checked by hand on Node v22.14.0, which is both the
// reference version and the `engines` minimum.

interface ImportMeta {
  // https://nodejs.org/docs/latest-v22.x/api/esm.html#importmetaurl  (absolute file: URL of the current module)
  readonly url: string;
}

// https://nodejs.org/docs/latest-v22.x/api/buffer.html#buffers-and-character-encodings
type BufferEncoding = "utf8" | "utf16le" | "latin1" | "base64" | "base64url" | "hex";

// https://nodejs.org/docs/latest-v22.x/api/buffer.html
// Buffer is a subclass of Uint8Array (docs: "The Buffer class is a subclass of JavaScript's Uint8Array class"). subarray() and slice() return a Buffer that SHARES memory with the
// original (Uint8Array.prototype.slice copies; Buffer.prototype.slice does not), hence both are redeclared:
// `fill(0)` on a slice zeroes the original. The backing store is declared as ArrayBuffer (never SharedArrayBuffer):
// that is true for every Buffer this code creates (from a string, Uint8Array, number[], alloc, concat, randomBytes).
interface Buffer extends Uint8Array<ArrayBuffer> {
  // `encoding` defaults to 'utf8'; `start`/`end` default to the whole buffer. Invalid UTF-8 becomes U+FFFD (never throws).
  toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  // Shares memory. `end` is exclusive; negative indexes count from the end.
  subarray(start?: number, end?: number): Buffer;
  // Shares memory (unlike Uint8Array.prototype.slice). Documented as "Stability 0 - Deprecated: Use buf.subarray" since v17.5.0,
  // but still present in Node 22.
  slice(start?: number, end?: number): Buffer;
  // Returns the buffer itself. `offset` defaults to 0, `end` to length, `encoding` to 'utf8'.
  // Docs: "Empty value (string, Uint8Array, Buffer) is coerced to 0", and (v10.0.0) filling a non-empty buffer with a zero-length
  // Buffer throws; invalid hex ('zz') "throws an exception". Observed: an EMPTY STRING fills with zeros; an empty Buffer/Uint8Array
  // throws TypeError ERR_INVALID_ARG_VALUE; a string that is not valid in `encoding` (e.g. 'zz' as hex) throws TypeError ERR_INVALID_ARG_VALUE.
  fill(value: string | Uint8Array | number, offset?: number, end?: number, encoding?: BufferEncoding): this;
  // `offset` defaults to 0 and must satisfy 0 <= offset <= buf.length - 4. The docs name no error; observed: reading past the end throws
  // RangeError ERR_BUFFER_OUT_OF_BOUNDS.
  readUInt32BE(offset?: number): number;
  // Returns offset + 4. `offset` defaults to 0. The docs call the result for a value that is not an unsigned 32-bit integer "undefined
  // behavior"; observed: RangeError ERR_OUT_OF_RANGE for a value outside [0, 2**32 - 1]. Do not rely on either; callers pass valid values.
  writeUInt32BE(value: number, offset?: number): number;
}

// The static side lives in its own interface: Uint8Array.from / Uint8Array.of have other signatures, and
// `declare class Buffer extends Uint8Array` fails the "static side incorrectly extends" check.
interface BufferConstructor {
  // `encoding` defaults to 'utf8'. With 'base64' / 'base64url' / 'hex' malformed input does NOT throw: invalid characters are
  // skipped (base64: Buffer.from('@@@@', 'base64') is empty, observed) or decoding stops at the first invalid pair (hex).
  // Callers that need strictness must validate before.
  from(value: string, encoding?: BufferEncoding): Buffer;
  // Copies the bytes (a new allocation, not a view).
  from(value: Uint8Array | readonly number[]): Buffer;
  // Zero-filled. Docs: ERR_OUT_OF_RANGE if `size` is larger than buffer.constants.MAX_LENGTH or smaller than 0; TypeError if not a number.
  alloc(size: number): Buffer;
  // `totalLength` defaults to the sum of the lengths. Always copies. An empty list yields a zero-length Buffer.
  concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
  isBuffer(obj: unknown): obj is Buffer;
  // The bytes `text` takes in `encoding` (default 'utf8'), without allocating a Buffer.
  byteLength(text: string, encoding?: BufferEncoding): number;
}
declare const Buffer: BufferConstructor;

// https://nodejs.org/docs/latest-v22.x/api/console.html
// Observed: the global console does NOT swallow write errors. `node -e "setInterval(() => console.log('x'), 5)" | head -1` dies with
// an unhandled 'error' event (Error: write EPIPE) once the reader closes the pipe. So console.log/error can crash the process.
interface Console {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
}
declare const console: Console;

declare namespace NodeJS {
  // https://nodejs.org/docs/latest-v22.x/api/timers.html#class-timeout
  interface Timeout {
    // Returns the same Timeout. An unref'ed timer does not keep the event loop alive.
    unref(): this;
  }

  // https://nodejs.org/docs/latest-v22.x/api/process.html#processplatform
  // Docs: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32', and "'android' may also be returned" (experimental).
  type Platform = "aix" | "android" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32";

  // The signals nullbrand handles or sends. https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events
  // Docs: SIGHUP is generated on Windows when the console window is closed (the process is then terminated about 10 s later);
  // SIGTERM "is not supported on Windows, it can be listened on"; SIGINT is supported everywhere.
  type Signals = "SIGHUP" | "SIGINT" | "SIGTERM";

  // https://nodejs.org/docs/latest-v22.x/api/process.html#processenv
  // READ-ONLY here: the docs say assigning a property implicitly converts it to a string (assigning `undefined` stores the
  // string "undefined"), so the code never writes to it. Every value is `string | undefined`; the keys the code reads are named
  // so that dot access type-checks under noPropertyAccessFromIndexSignature.
  interface ProcessEnv {
    readonly [key: string]: string | undefined;
    readonly NULLBRAND_HOME?: string | undefined;
    readonly NULLBRAND_LANG?: string | undefined;
    readonly NO_COLOR?: string | undefined;
    readonly PATH?: string | undefined;
    readonly DISPLAY?: string | undefined;
    readonly WAYLAND_DISPLAY?: string | undefined;
    readonly SSH_CONNECTION?: string | undefined;
    readonly SSH_CLIENT?: string | undefined;
    readonly SSH_TTY?: string | undefined;
    readonly WSL_DISTRO_NAME?: string | undefined;
    readonly WSL_INTEROP?: string | undefined;
  }

  // https://nodejs.org/docs/latest-v22.x/api/tty.html#readstreamistty and #writestreamistty
  // Docs: "a boolean that is always true for tty.ReadStream / tty.WriteStream instances"; process.stdin / process.stdout are a
  // net.Socket or, for a file, a plain Readable / Writable stream. Observed (piped): the property is ABSENT, so it reads as undefined.
  interface ReadStream {
    readonly isTTY: true | undefined;
  }

  // https://nodejs.org/docs/latest-v22.x/api/stream.html#writablewritechunk-encoding-callback
  interface WriteStream {
    readonly isTTY: true | undefined;
    // Returns false when the internal buffer is full (the data is still queued). Failures (EPIPE on a closed pipe, write after
    // end) are NOT thrown: they are emitted asynchronously as an 'error' event on the stream. `encoding` defaults to 'utf8'.
    write(chunk: string): boolean;
    // https://nodejs.org/docs/latest-v22.x/api/stream.html#event-error
    // 'error' is emitted when writing or piping failed (EPIPE once the reader closed the pipe). The listener gets the Error; its
    // `code` is not typed (Error has none), so callers narrow it with a hand-written guard.
    on(event: "error", listener: (err: Error) => void): this;
  }

  // https://nodejs.org/docs/latest-v22.x/api/process.html
  interface Process {
    // [execPath, scriptPath, ...userArgs]
    readonly argv: string[];
    readonly env: ProcessEnv;
    readonly pid: number;
    readonly platform: Platform;
    readonly versions: { readonly node: string };
    readonly stdin: ReadStream;
    readonly stdout: WriteStream;
    readonly stderr: WriteStream;
    // https://nodejs.org/docs/latest-v22.x/api/process.html#processexitcode
    // The docs allow integer | string | null | undefined (string only if it holds an integer; unchanged since v20.0.0); this code only
    // ever assigns numbers.
    exitCode: number | undefined;
    // Terminates synchronously; 'exit' listeners run, but pending async work is abandoned. `code` defaults to process.exitCode or 0.
    exit(code?: number): never;
    // Docs: "This function not available on Windows" (so the property is absent there). https://nodejs.org/docs/latest-v22.x/api/process.html#processgetuid
    readonly getuid?: () => number;
    // https://nodejs.org/docs/latest-v22.x/api/process.html#event-beforeexit
    // Emitted when the loop empties; `code` is process.exitCode (or 0). Not emitted for process.exit() or uncaught exceptions.
    on(event: "beforeExit", listener: (code: number) => void): this;
    // https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events
    // The handler receives the signal's name as its first argument. Installing a listener for SIGINT/SIGTERM removes Node's default
    // "exit on signal" behaviour. Only the signals in `Signals` are declared; other events ('exit', 'uncaughtException'...) hand their
    // listeners different arguments and are not used.
    on(event: Signals, listener: (signal: Signals) => void): this;
    // Removes the listener (same reference). A no-op if it was not registered.
    off(event: "beforeExit", listener: (code: number) => void): this;
    off(event: Signals, listener: (signal: Signals) => void): this;
  }
}

declare const process: NodeJS.Process;

// https://nodejs.org/docs/latest-v22.x/api/timers.html#settimeoutcallback-delay-args
// `delay` defaults to 1; a delay < 1 or > 2147483647 is set to 1 (with a TimeoutOverflowWarning for the latter).
// A non-function `callback` throws TypeError (ERR_INVALID_ARG_TYPE). An exception thrown BY `callback` is not delivered to the caller:
// it becomes an uncaughtException.
declare function setTimeout(callback: () => void, delay?: number): NodeJS.Timeout;
declare function setInterval(callback: () => void, delay?: number): NodeJS.Timeout;
// https://nodejs.org/docs/latest-v22.x/api/timers.html#cleartimeouttimeout
// Faithful to the docs (<Timeout> | <string> | <number>), narrowed to the Timeout object the code holds. `undefined` is NOT accepted:
// callers that may hold no timer (clipboard.ts) guard with `if (timer !== undefined)`, which is equivalent because clearing a
// timer that was never armed does nothing.
declare function clearTimeout(timeout: NodeJS.Timeout): void;
declare function clearInterval(timeout: NodeJS.Timeout): void;

// https://nodejs.org/docs/latest-v22.x/api/url.html#class-url  (a global since Node 10)
declare class URL {
  // Docs: "A TypeError will be thrown if the input or base are not valid URLs"; observed code ERR_INVALID_URL. Non-string arguments are
  // converted to strings first.
  constructor(input: string, base?: string | URL);
  // Percent-encoded path component, always starting with '/' for http(s) URLs.
  readonly pathname: string;
  // Docs: `host` is the hostname plus the port when it is not the default one; `hostname` has no port. IPv6 hosts keep their brackets.
  readonly host: string;
  readonly hostname: string;
  readonly searchParams: URLSearchParams;
}

// https://nodejs.org/docs/latest-v22.x/api/url.html#class-urlsearchparams
declare class URLSearchParams {
  // The FIRST value for `name`, or null if it is absent. Never throws.
  get(name: string): string | null;
}
