// Hand-written declarations for node:path (the parts nullbrand uses). Reference: Node.js 22.14.
// Docs: https://nodejs.org/docs/latest-v22.x/api/path.html
// These functions follow the CURRENT platform's rules (posix or win32). All of them throw TypeError (ERR_INVALID_ARG_TYPE)
// when an argument is not a string; none of them touches the file system (except resolve, which reads process.cwd()).
declare module "node:path" {
  // Zero-length segments are ignored; no segments at all returns '.'.
  function join(...paths: string[]): string;
  // Right to left until an absolute path is built; falls back to process.cwd(). The result has no trailing slash.
  function resolve(...paths: string[]): string;
  function normalize(path: string): string;
  function dirname(path: string): string;
  // `suffix` is removed from the end when it matches.
  function basename(path: string, suffix?: string): string;
  function extname(path: string): string;
  // https://nodejs.org/docs/latest-v22.x/api/path.html#pathdelimiter  (';' on Windows, ':' on POSIX)
  const delimiter: ";" | ":";
}
