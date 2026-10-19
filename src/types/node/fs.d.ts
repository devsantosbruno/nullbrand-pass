// Hand-written typings for the subset of node:fs and node:fs/promises nullbrand uses, so the project needs no @types/node.
declare module "node:fs" {
  interface Stats {
    readonly uid: number;
    readonly mode: number;
    readonly size: number;
    isFile(): boolean;
  }
  function existsSync(path: string): boolean;
  function readFileSync(path: string | URL, encoding: "utf8"): string;
  const promises: typeof import("node:fs/promises");
}

declare module "node:fs/promises" {
  import type { Stats } from "node:fs";

  interface FileHandle {
    writeFile(data: string | Uint8Array): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }
  function open(path: string, flags: string, mode?: number): Promise<FileHandle>;
  function readFile(path: string | URL): Promise<Buffer>;
  function readFile(path: string | URL, encoding: "utf8"): Promise<string>;
  function writeFile(path: string, data: string | Uint8Array, options?: { mode?: number; flag?: string }): Promise<void>;
  function mkdir(path: string, options: { recursive: true; mode?: number }): Promise<string | undefined>;
  function rename(oldPath: string, newPath: string): Promise<void>;
  function unlink(path: string): Promise<void>;
  function stat(path: string): Promise<Stats>;
  function lstat(path: string): Promise<Stats>;
  function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  function chmod(path: string, mode: number): Promise<void>;
  function readdir(path: string): Promise<string[]>;
  function access(path: string, mode?: number): Promise<void>;
  const constants: { readonly X_OK: number };
}
