# Security policy

## Supported versions

Only the latest published version of `nullbrand` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub's "Report a vulnerability" button in the repository's **Security** tab (private vulnerability reporting), or through the contact page at <https://nullbrand.com/#contact>.

Include the version, your OS and Node.js version, and steps to reproduce. You can expect an acknowledgement within 7 days. Fixes are released as a new version and credited to the reporter unless you prefer otherwise.

## Scope and known limitations

The threat model is documented in the README ("Security model"). In short, nullbrand protects the vault file at rest and the local web interface against other machines, malicious websites and other local users. It does **not** protect against malware running as your user (memory reads, keyloggers).

This project has not had an independent security audit.

### Desktop app

The desktop app (`desktop/`) runs the same local server inside its own process and shows it in one window. Its model, beyond the README table:

- **In scope:** other local users, other processes that can open a TCP connection to `127.0.0.1`, and web pages (including DNS rebinding). Each launch generates a random 256-bit secret kept in the main process only; the server refuses every request without it (403, constant-time comparison, checked before `Host`, `Origin`, the token and the cookie). The window gets the secret from a main-process request hook that replaces any header of the same name and adds it only to requests to the app origin. It is never in an argument, an environment variable, a file, a URL or the page, so it does not show in `ps` or Task Manager.
- **Out of scope:** malware running as your user. It can read the main process memory, attach a debugger or capture the keyboard, and so reach the secret. The server socket is TCP on loopback, not a Unix socket or named pipe, so the secret (not the socket) is the access control.
- **Auto-lock:** system sleep and screen lock lock the vault (key zeroed, clipboard cleared) and reload the window to the unlock screen. Closing the window quits the app and locks the vault. Minimizing does not lock; the inactivity timer (15 min) covers it.
- **Unchanged:** the CLI keeps the browser flow (single-use token in a link, 60 s). That link can appear in the process list while the browser opens.

## Review status

- **No independent audit.** An independent cryptographic audit is planned only once the project has real usage, and before any `1.0` release. Until then the version stays `0.x`.
- **Internal review (not a substitute for an audit).** An AI-assisted code review covered `src/crypto.ts`, `src/vault.ts` and `src/server.ts`. It found no flaw in the use of scrypt / AES-256-GCM (random 96-bit IV per save, header bound as AAD, 16-byte tag enforced, constant-time comparisons) or in the local server's access control (127.0.0.1 only, Host/Origin checks, single-use token, HttpOnly session). It led to one hardening change (a previous in-memory key is now zeroed if the vault is unlocked a second time).
- **Known limitations and open points:**
  - Decrypted items live in ordinary JavaScript strings, which cannot be reliably wiped from memory.
  - The minimum master password length is 8 characters; use a long passphrase.
  - On Windows the clipboard copy is not excluded from Clipboard History or cloud clipboard sync (`ExcludeClipboardContentFromMonitorProcessing` is not set), so a copied password can appear in Win+V history until the 30 s clear runs. The clear empties the current clipboard, not entries already stored in that history. Turn Clipboard History off if that matters to you.
  - Concurrent unlock requests are not rate-limited (each costs ~128 MiB), although they require a valid local session.
  - Old `*.bak-*` files created by a format migration keep the old (weaker) key-derivation settings; delete them once the new vault opens.
  - A file-system attacker can roll the vault back to an older valid copy (inherent to a single-file design).

Independent reviews are welcome: see "Reporting a vulnerability" above.
