// Hand-written declarations for node:fs and node:fs/promises (the parts nullbrand uses). Reference: Node.js 22.14.
// Docs: https://nodejs.org/docs/latest-v22.x/api/fs.html
// Every promise-returning function REJECTS with an Error that carries `code` (ENOENT, EEXIST, EACCES, EISDIR, ENOTDIR, EPERM...),
// `errno`, `syscall` and `path`; the catch site receives `unknown` and must narrow it with a guard.
// `Observed:` = checked by hand on Node v22.14.0 (the reference version) where the docs are silent.
declare module "node:fs" {
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#class-fsstats
  // Docs: `uid` is "the numeric user identifier of the user that owns the file (POSIX)"; `mode` is "a bit-field describing the file type and mode".
  interface Stats {
    readonly uid: number;
    readonly mode: number;
    // https://nodejs.org/docs/latest-v22.x/api/fs.html#statsisfile  ("true if the <fs.Stats> object describes a regular file")
    isFile(): boolean;
  }
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fsexistssyncpath
  // Docs: "Returns true if the path exists, false otherwise". Observed: it never threw; a path inside a directory with mode 000 and
  // invalid arguments (a number, undefined) both give false.
  function existsSync(path: string): boolean;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fsreadfilesyncpath-options
  // Throws (ENOENT, EISDIR, EACCES...) on failure. A `file:` URL is accepted for `path`.
  function readFileSync(path: string | URL, encoding: "utf8"): string;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesapi
  const promises: typeof import("node:fs/promises");
}

declare module "node:fs/promises" {
  import type { Stats } from "node:fs";

  // https://nodejs.org/docs/latest-v22.x/api/fs.html#class-filehandle
  interface FileHandle {
    // Rejects on a write error. Writes the whole string/buffer ('utf8' for strings).
    writeFile(data: string | Uint8Array): Promise<void>;
    // fsync(2). Rejects with EINVAL / ENOTSUP on some file systems and for directories on some platforms.
    sync(): Promise<void>;
    // Resolves once the handle is closed. Observed: closing a second time ALSO resolves (undefined), it does not reject;
    // any other operation on a closed handle (e.g. sync()) rejects with Error EBADF "file closed".
    close(): Promise<void>;
  }
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesopenpath-flags-mode
  // `flags` defaults to 'r' and `mode` to 0o666 in the docs; here `flags` is required (every call passes it). `mode` only applies when
  // the file is created. 'wx' rejects with EEXIST if the path exists. The caller MUST close the handle.
  function open(path: string, flags: string, mode?: number): Promise<FileHandle>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesreadfilepath-options
  // Without an encoding it resolves to a Buffer; with 'utf8' to a string. Rejects with ENOENT, EISDIR, EACCES...
  function readFile(path: string | URL): Promise<Buffer>;
  function readFile(path: string | URL, encoding: "utf8"): Promise<string>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromiseswritefilefile-data-options
  // `mode` (default 0o666) is applied only when the file is created and is filtered by the umask. `flag` defaults to 'w';
  // 'wx' rejects with EEXIST if the file exists. Data is written as UTF-8 when a string.
  function writeFile(path: string, data: string | Uint8Array, options?: { mode?: number; flag?: string }): Promise<void>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesmkdirpath-options
  // Only the recursive form is declared. With `recursive: true` it does not reject if the directory exists. Observed: it resolves to
  // the FIRST directory path it created (mkdir -p a/b/c on an empty dir resolves to ".../a"), and to undefined when nothing had to
  // be created (the docs say only "the first directory path created"). `mode` (default 0o777, filtered by the umask) is not supported on Windows.
  function mkdir(path: string, options: { recursive: true; mode?: number }): Promise<string | undefined>;
  // Atomic on POSIX when both paths are on the same file system. Rejects with ENOENT, EXDEV, EPERM...
  function rename(oldPath: string, newPath: string): Promise<void>;
  // Rejects with ENOENT if the path does not exist, EISDIR/EPERM for a directory.
  function unlink(path: string): Promise<void>;
  // Follows symbolic links. Rejects with ENOENT, EACCES...
  function stat(path: string): Promise<Stats>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromiseslstatpath-options
  // Like stat(), but does not follow symbolic links: for a link, isFile() is false. Rejects with ENOENT, EACCES...
  function lstat(path: string): Promise<Stats>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesrmpath-options
  // With `force: true` it does not reject when the path does not exist; with `recursive: true` it removes a directory and its contents.
  function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  // Rejects with ENOENT, EPERM...
  function chmod(path: string, mode: number): Promise<void>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesreaddirpath-options
  // Resolves to entry NAMES (not paths), excluding '.' and '..', in no guaranteed order. `path` may also be a Buffer or URL (the code passes
  // strings). Rejects with ENOENT, ENOTDIR...
  function readdir(path: string): Promise<string[]>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesaccesspath-mode
  // Resolves to undefined if the check passes; REJECTS (ENOENT / EACCES) if it does not.
  function access(path: string, mode?: number): Promise<void>;
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#file-access-constants  (on Windows X_OK behaves like F_OK)
  const constants: { readonly X_OK: number };
}
