// Hand-written declarations for node:os and node:url (the parts nullbrand uses). Reference: Node.js 22.14.
// Docs: https://nodejs.org/docs/latest-v22.x/api/os.html and https://nodejs.org/docs/latest-v22.x/api/url.html
declare module "node:os" {
  // https://nodejs.org/docs/latest-v22.x/api/os.html#oshomedir
  // POSIX: $HOME if set, otherwise the home of the effective uid from the password database. Windows: %USERPROFILE%.
  // Observed: with HOME unset it falls back to the password database and still returns the home directory.
  // Observed: with no $HOME and a uid absent from the password database (docker run --user 12345:12345 node:22.14.0-alpine) it THROWS
  // a SystemError, code ERR_SYSTEM_ERROR, "uv_os_homedir returned ENOENT"; it does not return '' or '/'. The docs are silent.
  function homedir(): string;
}

declare module "node:url" {
  // https://nodejs.org/docs/latest-v22.x/api/url.html#urlfileurltopathurl
  // The docs list no errors. Observed, all TypeErrors: ERR_INVALID_URL_SCHEME for a non-`file:` URL, ERR_INVALID_FILE_URL_HOST for a host
  // other than "localhost" or empty, ERR_INVALID_FILE_URL_PATH for an encoded '/' on POSIX. A URL ending in '/' yields a path ending in '/'.
  // The `options` argument (`{ windows }`, added v22.1.0) is not declared: it is not used.
  function fileURLToPath(url: string | URL): string;
}
