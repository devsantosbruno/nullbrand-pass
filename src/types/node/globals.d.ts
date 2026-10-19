// Hand-written typings for the Node globals nullbrand uses (process, Buffer, console, timers, URL), so the project needs no @types/node.

interface ImportMeta {
  readonly url: string;
}

type BufferEncoding = "utf8" | "utf16le" | "latin1" | "base64" | "base64url" | "hex";

interface Buffer extends Uint8Array<ArrayBuffer> {
  toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  subarray(start?: number, end?: number): Buffer;
  slice(start?: number, end?: number): Buffer;
  fill(value: string | Uint8Array | number, offset?: number, end?: number, encoding?: BufferEncoding): this;
  readUInt32BE(offset?: number): number;
  writeUInt32BE(value: number, offset?: number): number;
}

interface BufferConstructor {
  from(value: string, encoding?: BufferEncoding): Buffer;
  from(value: Uint8Array | readonly number[]): Buffer;
  alloc(size: number): Buffer;
  concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
  isBuffer(obj: unknown): obj is Buffer;
  byteLength(text: string, encoding?: BufferEncoding): number;
}
declare const Buffer: BufferConstructor;

interface Console {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
}
declare const console: Console;

declare namespace NodeJS {
  interface Timeout {
    unref(): this;
  }

  type Platform = "aix" | "android" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32";

  type Signals = "SIGHUP" | "SIGINT" | "SIGTERM";

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

  interface ReadStream {
    readonly isTTY: true | undefined;
  }

  interface WriteStream {
    readonly isTTY: true | undefined;
    write(chunk: string): boolean;
    on(event: "error", listener: (err: Error) => void): this;
  }

  interface Process {
    readonly argv: string[];
    readonly env: ProcessEnv;
    readonly pid: number;
    readonly platform: Platform;
    readonly versions: { readonly node: string };
    readonly stdin: ReadStream;
    readonly stdout: WriteStream;
    readonly stderr: WriteStream;
    exitCode: number | undefined;
    exit(code?: number): never;
    readonly getuid?: () => number;
    on(event: "beforeExit", listener: (code: number) => void): this;
    on(event: Signals, listener: (signal: Signals) => void): this;
    off(event: "beforeExit", listener: (code: number) => void): this;
    off(event: Signals, listener: (signal: Signals) => void): this;
  }
}

declare const process: NodeJS.Process;

declare function setTimeout(callback: () => void, delay?: number): NodeJS.Timeout;
declare function setInterval(callback: () => void, delay?: number): NodeJS.Timeout;
declare function clearTimeout(timeout: NodeJS.Timeout): void;
declare function clearInterval(timeout: NodeJS.Timeout): void;

declare class TextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer>;
}
declare class TextDecoder {
  decode(input?: Uint8Array): string;
}

declare class URL {
  constructor(input: string, base?: string | URL);
  readonly pathname: string;
  readonly host: string;
  readonly hostname: string;
  readonly searchParams: URLSearchParams;
}

declare class URLSearchParams {
  get(name: string): string | null;
}
