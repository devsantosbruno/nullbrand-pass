// Hand-written declarations for the Node.js APIs used ONLY by the tests (node:test, node:assert/strict, node:events, the http
// client, fetch and a few fs/os/process extras). Reference: Node.js 22.14. Included only by tsconfig.test.json; the production
// code never sees these. The `declare module` blocks below MERGE with the ones in src/types/node/.
// Docs: https://nodejs.org/docs/latest-v22.x/api/test.html and https://nodejs.org/docs/latest-v22.x/api/assert.html
// `Observed:` = checked by hand on Node v22.14.0 (the reference version) where the docs are silent. `// VERIFICAR:` = still unsettled.

declare module "node:test" {
  // https://nodejs.org/docs/latest-v22.x/api/test.html#testname-options-fn
  interface TestOptions {
    // true, or a string with the reason. A skipped test is reported as skipped and its function is not run.
    skip?: boolean | string | undefined;
  }

  // https://nodejs.org/docs/latest-v22.x/api/test.html#class-mocktimers
  // Docs: "Stability: 1 - Experimental". The object form `enable({ apis, now })` and the 'Date' api exist since v21.2.0 / v20.11.0 (before
  // that the argument was an array of names), so they are available at the 22.14 minimum. `apis` defaults to all four.
  interface MockTimers {
    // Replaces the listed globals with fake ones. Docs: after each test completes, reset() is called on the context's MockTracker.
    enable(options: { apis: readonly ("setTimeout" | "setInterval" | "setImmediate" | "Date")[] }): void;
    // Advances the fake clock by `milliseconds` (docs: default 1), running every timer that becomes due.
    tick(milliseconds?: number): void;
  }
  interface MockTracker {
    readonly timers: MockTimers;
    // https://nodejs.org/docs/latest-v22.x/api/test.html#mockmethodobject-methodname-implementation-options
    // Replaces object[methodName] with `implementation`; restored when the test finishes (the context's tracker is reset).
    method<T extends object, K extends keyof T & string>(object: T, methodName: K, implementation: (...args: never[]) => unknown): void;
  }

  // https://nodejs.org/docs/latest-v22.x/api/test.html#class-testcontext
  interface TestContext {
    readonly mock: MockTracker;
    // https://nodejs.org/docs/latest-v22.x/api/test.html#contextskipmessage  (marks the running test as skipped; does not stop the function)
    skip(message?: string): void;
  }

  // https://nodejs.org/docs/latest-v22.x/api/test.html#testname-options-fn
  // `fn` may return a promise; a rejection (or a thrown AssertionError) fails the test. The returned promise resolves when the test
  // finishes and never rejects because of a failing test (failures are reported by the runner).
  function test(name: string, fn: (t: TestContext) => void | Promise<void>): Promise<void>;
  function test(name: string, options: TestOptions, fn: (t: TestContext) => void | Promise<void>): Promise<void>;
}

declare module "node:assert/strict" {
  // The `strict` flavour: equal === strictEqual, deepEqual === deepStrictEqual, notEqual === notStrictEqual.
  // Every failing assertion THROWS an AssertionError (an Error whose `code` is 'ERR_ASSERTION'); a passing one returns undefined.
  // The narrowing signatures mirror what the real library promises: after a passing call the compiler may assume the fact.
  // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertthrowsfn-error-message  (error: RegExp | Function | Object | Error)
  //  - RegExp: tested against the string form of the thrown value.
  //  - function: a class (the thrown value must be an instance of it) or a validation function that must return exactly `true`.
  //  - object: every own enumerable property of `error` is compared (deep strict equality; a RegExp value is tested against the
  //    string property). The object form declared here is the plain-object one the tests use (e.g. `{ code: 'X' }`).
  type Validator = RegExp | ((err: unknown) => boolean) | (abstract new (...args: never[]) => Error) | Readonly<Record<string, unknown>>;

  interface Assert {
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertokvalue-message
    ok(value: unknown, message?: string | Error): asserts value;
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertstrictequalactual-expected-message  (SameValue comparison)
    equal<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T;
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertnotstrictequalactual-expected-message
    notEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertdeepstrictequalactual-expected-message
    deepEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T;
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertmatchstring-regexp-message
    // Fails if `value` is not a string or does not match.
    match(value: string, regexp: RegExp, message?: string | Error): void;
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertdoesnotmatchstring-regexp-message
    doesNotMatch(value: string, regexp: RegExp, message?: string | Error): void;
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertthrowsfn-error-message
    // `error` as a RegExp is tested against the error's string form; as a function it receives the thrown value and MUST return
    // exactly `true` for the assertion to pass (any other return value fails it). Fails if `fn` does not throw.
    // Docs: a string given as the second argument is the `message`, not an `error` validator (avoid ambiguity).
    throws(fn: () => unknown, error?: Validator, message?: string): void;
    throws(fn: () => unknown, message: string): void;
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertrejectsasyncfn-error-message
    // Accepts a promise or a function returning one. Resolves when the promise rejects and `error` (if given) matches; REJECTS with
    // an AssertionError if it resolved instead. Must be awaited.
    // As in throws(): a string second argument is the `message`.
    rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), error?: Validator, message?: string): Promise<void>;
    rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), message: string): Promise<void>;
    // https://nodejs.org/docs/latest-v22.x/api/assert.html#assertfailmessage
    fail(message?: string | Error): never;
  }

  const assert: Assert;
  export default assert;
}

declare module "node:events" {
  // https://nodejs.org/docs/latest-v22.x/api/events.html#class-eventemitter
  // Docs: `emit` synchronously calls each listener in order and returns true if the event had listeners, false otherwise; listener return
  // values are ignored; emitting 'error' with no 'error' listener throws it. The docs do not say what happens when a listener throws;
  // observed: `emit` rethrows that error synchronously.
  class EventEmitter {
    // Docs: `listener` is any function (it receives the emitted arguments); `(...args: never[]) => void` is the type every function
    // is assignable to, so a typed listener such as `(err: Error) => void` can be passed (and a subclass can narrow the overloads).
    on(event: string, listener: (...args: never[]) => void): this;
    once(event: string, listener: (...args: never[]) => void): this;
    off(event: string, listener: (...args: never[]) => void): this;
    emit(event: string, ...args: unknown[]): boolean;
    // https://nodejs.org/docs/latest-v22.x/api/events.html#emitterlistenercounteventname-listener  (number of listeners for the event)
    listenerCount(event: string): number;
  }
  export { EventEmitter };
}

declare module "node:http" {
  // https://nodejs.org/docs/latest-v22.x/api/http.html#class-httpclientrequest
  interface ClientRequest {
    // Docs: any error during the request (DNS, TCP, HTTP parsing) is emitted as 'error' on the request; with no listener it is thrown.
    on(event: "error", listener: (err: Error) => void): this;
    // Sends `chunk` (UTF-8 if a string) as the last part of the body and finishes the request.
    end(chunk?: string): this;
  }
  // The same IncomingMessage interface also describes the RESPONSE seen by a client. Members used only there:
  interface IncomingMessage {
    // https://nodejs.org/docs/latest-v22.x/api/http.html#messagestatuscode  (only valid on a response obtained from http.request)
    readonly statusCode?: number | undefined;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "end", listener: () => void): this;
  }
  // https://nodejs.org/docs/latest-v22.x/api/http.html#httprequestoptions-callback
  // `callback` is added as a one-time 'response' listener. The request is NOT sent until `end()` is called.
  function request(
    options: {
      host: string;
      port: number;
      method: string;
      path: string;
      headers?: { [header: string]: string | undefined };
    },
    callback: (res: IncomingMessage) => void,
  ): ClientRequest;
}

declare module "node:fs" {
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fsmkdtempsyncprefix-options  (unique temporary directory; returns its path)
  function mkdtempSync(prefix: string): string;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fsreaddirsyncpath-options  (entry names; throws ENOENT / ENOTDIR on failure)
  function readdirSync(path: string | URL): string[];
}

declare module "node:fs/promises" {
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesmkdirpath-options  (non-recursive form, used by the tests only)
  // Observed on 22.14: resolves to undefined; rejects with EEXIST when the path already exists.
  function mkdir(path: string, options: { recursive?: false; mode?: number }): Promise<undefined>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesreaddirpath-options  (a URL is accepted for `path`; i18n.test.js passes one)
  function readdir(path: URL): Promise<string[]>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesmkdtempprefix-options
  // Docs: creates a unique temporary directory; fulfills with its path. (`prefix` may also be a Buffer or URL since v20.6.0; strings here.)
  function mkdtemp(prefix: string): Promise<string>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesrmpath-options
  // With `force: true` a missing path is not an error; without `recursive: true` removing a directory rejects (ERR_FS_EISDIR).
  function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisessymlinktarget-path-type
  // Creates a symbolic link at `path` pointing to `target`. Rejects with EEXIST if `path` exists (Windows may need privileges).
  function symlink(target: string, path: string): Promise<void>;
}

declare module "node:child_process" {
  // https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processexecfilesyncfile-args-options
  // Docs: runs the file synchronously and returns its stdout (a string when `encoding` is given); `input` is written to the child's
  // stdin. Throws when the child times out or exits with a non-zero code. Only the form the tests use is declared.
  function execFileSync(
    file: string,
    args: readonly string[],
    options: { input?: string; encoding: "utf8"; timeout?: number; env?: { [key: string]: string | undefined } },
  ): string;

  // https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processspawnsynccommand-args-options
  // Docs: runs the command synchronously and returns { status, stdout, stderr, ... }; `status` is the exit code, or null if the child was
  // ended by a signal; with `encoding` set, stdout/stderr are strings. It does not throw for a non-zero exit.
  interface SpawnSyncResult {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }
  function spawnSync(
    command: string,
    args: readonly string[],
    options: { encoding: "utf8"; input?: string; env?: { [key: string]: string | undefined } },
  ): SpawnSyncResult;

  // https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processspawncommand-args-options  (`env`: environment key-value
  // pairs, default process.env). Production code never passes it; a test reads it to prove that.
  interface SpawnOptions {
    env?: { [key: string]: string | undefined };
  }
}

declare module "node:net" {
  // https://nodejs.org/docs/latest-v22.x/api/net.html#class-netsocket  (the client side, as the tests use it)
  interface Socket {
    // Sends `data` (UTF-8 for a string). Docs: returns true if the whole data was flushed to the kernel buffer.
    write(data: string): boolean;
    // Closes the socket at once; no more I/O happens on it.
    destroy(): this;
    // Docs: 'error' is emitted when an error occurs (the 'close' event follows); with no listener it is thrown.
    on(event: "error", listener: (err: Error) => void): this;
  }
  // https://nodejs.org/docs/latest-v22.x/api/net.html#netconnectport-host-connectlistener
  // `connectListener` is added once to the 'connect' event.
  function connect(port: number, host: string, connectListener: () => void): Socket;
}

declare module "node:os" {
  // https://nodejs.org/docs/latest-v22.x/api/os.html#ostmpdir  (non-Windows: TMPDIR, TMP, TEMP in that order, else /tmp; no trailing slash)
  function tmpdir(): string;
}

declare namespace NodeJS {
  interface Process {
    // https://nodejs.org/docs/latest-v22.x/api/process.html#processexecpath  (absolute path of the executable that started the process)
    readonly execPath: string;
    // https://nodejs.org/docs/latest-v22.x/api/process.html#processumaskmask  (not available in Worker threads; Windows ignores it)
    // Docs: sets the file mode creation mask and "returns the previous mask"; throws in Worker threads. The no-argument form is not declared.
    umask(mask: number): number;
    // https://nodejs.org/docs/latest-v22.x/api/process.html#event-unhandledrejection
    // Docs: emitted when a Promise is rejected with no handler attached within a turn; the listener gets (reason, promise). `reason` is
    // whatever the promise was rejected with (the docs type it <Error> | <any>), hence `unknown`. Registering a listener replaces the
    // default behaviour (the process no longer dies on it).
    on(event: "unhandledRejection", listener: (reason: unknown, promise: Promise<unknown>) => void): this;
    off(event: "unhandledRejection", listener: (reason: unknown, promise: Promise<unknown>) => void): this;
  }
}

// https://nodejs.org/docs/latest-v22.x/api/buffer.html#bufincludesvalue-byteoffset-encoding
// Docs: value is string | Buffer | Uint8Array | integer; returns whether it was found. Only the tests use it.
interface Buffer {
  includes(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): boolean;
}

// https://nodejs.org/docs/latest-v22.x/api/url.html#urlhref  (the whole URL as a string)
interface URL {
  readonly href: string;
}

// https://nodejs.org/docs/latest-v22.x/api/buffer.html#static-method-bufferallocsize-fill-encoding
// Docs: `fill` (default 0) is a string, Buffer, Uint8Array or integer used to pre-fill the new buffer. Only the integer form is used.
// https://nodejs.org/docs/latest-v22.x/api/buffer.html#class-buffer  (`Buffer.prototype` is where the instance methods live; a test
// wraps `fill` to watch which buffers get zeroed.)
interface BufferConstructor {
  alloc(size: number, fill: number): Buffer;
  readonly prototype: Buffer;
}

declare function setImmediate(callback: () => void): void;
declare function structuredClone<T>(value: T): T;

// https://nodejs.org/docs/latest-v22.x/api/globals.html#fetch  (global fetch; "no longer experimental" since v21.0.0)
interface Headers {
  get(name: string): string | null;
  // Docs (Headers is iterable): yields [name, value] pairs, names lower-cased, sorted.
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
interface RequestInit {
  method?: string | undefined;
  headers?: { [header: string]: string | undefined } | undefined;
  body?: string | undefined;
  // 'manual' returns the 3xx response itself instead of following it.
  redirect?: "follow" | "manual" | "error" | undefined;
}
interface Response {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  // Resolve to the body; `json()` rejects with a SyntaxError when the body is not valid JSON. Typed `unknown`: it is an input boundary.
  json(): Promise<unknown>;
  text(): Promise<string>;
}
// Rejects (TypeError: fetch failed, with a `cause` carrying the system error) when the connection fails; an HTTP error status does NOT reject.
declare function fetch(input: string, init?: RequestInit): Promise<Response>;
