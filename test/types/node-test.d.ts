
declare module "node:test" {
  interface TestOptions {
    skip?: boolean | string | undefined;
  }

  interface MockTimers {
    enable(options: { apis: readonly ("setTimeout" | "setInterval" | "setImmediate" | "Date")[] }): void;
    tick(milliseconds?: number): void;
  }
  interface MockTracker {
    readonly timers: MockTimers;
    method<T extends object, K extends keyof T & string>(object: T, methodName: K, implementation: (...args: never[]) => unknown): void;
  }

  interface TestContext {
    readonly mock: MockTracker;
    skip(message?: string): void;
  }

  function test(name: string, fn: (t: TestContext) => void | Promise<void>): Promise<void>;
  function test(name: string, options: TestOptions, fn: (t: TestContext) => void | Promise<void>): Promise<void>;
}

declare module "node:assert/strict" {
  type Validator = RegExp | ((err: unknown) => boolean) | (abstract new (...args: never[]) => Error) | Readonly<Record<string, unknown>>;

  interface Assert {
    ok(value: unknown, message?: string | Error): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T;
    notEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T;
    match(value: string, regexp: RegExp, message?: string | Error): void;
    doesNotMatch(value: string, regexp: RegExp, message?: string | Error): void;
    throws(fn: () => unknown, error?: Validator, message?: string): void;
    throws(fn: () => unknown, message: string): void;
    rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), error?: Validator, message?: string): Promise<void>;
    rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), message: string): Promise<void>;
    fail(message?: string | Error): never;
  }

  const assert: Assert;
  export default assert;
}

declare module "node:events" {
  class EventEmitter {
    on(event: string, listener: (...args: never[]) => void): this;
    once(event: string, listener: (...args: never[]) => void): this;
    off(event: string, listener: (...args: never[]) => void): this;
    emit(event: string, ...args: unknown[]): boolean;
    listenerCount(event: string): number;
  }
  export { EventEmitter };
}

declare module "node:http" {
  interface ClientRequest {
    on(event: "error", listener: (err: Error) => void): this;
    end(chunk?: string): this;
  }
  interface IncomingMessage {
    readonly statusCode?: number | undefined;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "end", listener: () => void): this;
  }
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
  function mkdtempSync(prefix: string): string;
  function readdirSync(path: string | URL): string[];
}

declare module "node:fs/promises" {
  function mkdir(path: string, options: { recursive?: false; mode?: number }): Promise<undefined>;
  function readdir(path: URL): Promise<string[]>;
  function mkdtemp(prefix: string): Promise<string>;
  function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  function symlink(target: string, path: string): Promise<void>;
}

declare module "node:child_process" {
  function execFileSync(
    file: string,
    args: readonly string[],
    options: { input?: string; encoding: "utf8"; timeout?: number; env?: { [key: string]: string | undefined } },
  ): string;

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

  interface SpawnOptions {
    env?: { [key: string]: string | undefined };
  }
}

declare module "node:net" {
  interface Socket {
    write(data: string): boolean;
    destroy(): this;
    on(event: "error", listener: (err: Error) => void): this;
  }
  function connect(port: number, host: string, connectListener: () => void): Socket;
}

declare module "node:os" {
  function tmpdir(): string;
}

declare namespace NodeJS {
  interface Process {
    readonly execPath: string;
    umask(mask: number): number;
    on(event: "unhandledRejection", listener: (reason: unknown, promise: Promise<unknown>) => void): this;
    off(event: "unhandledRejection", listener: (reason: unknown, promise: Promise<unknown>) => void): this;
  }
}

interface Buffer {
  includes(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): boolean;
}

interface URL {
  readonly href: string;
}

interface BufferConstructor {
  alloc(size: number, fill: number): Buffer;
  readonly prototype: Buffer;
}

declare function setImmediate(callback: () => void): void;
declare function structuredClone<T>(value: T): T;

interface Headers {
  get(name: string): string | null;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
interface RequestInit {
  method?: string | undefined;
  headers?: { [header: string]: string | undefined } | undefined;
  body?: string | undefined;
  redirect?: "follow" | "manual" | "error" | undefined;
}
interface Response {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
declare function fetch(input: string, init?: RequestInit): Promise<Response>;
