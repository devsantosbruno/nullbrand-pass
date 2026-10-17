# Security policy

## Supported versions

Only the latest published version of `nullbrand` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub's "Report a vulnerability" button in the repository's **Security** tab (private vulnerability reporting).

Include the version, your OS and Node.js version, and steps to reproduce. You can expect an acknowledgement within 7 days. Fixes are released as a new version and credited to the reporter unless you prefer otherwise.

## Scope and known limitations

The threat model is documented in the README ("Security model"). In short, nullbrand protects the vault file at rest and the local web interface against other machines, malicious websites and other local users. It does **not** protect against malware running as your user (memory reads, keyloggers).

This project has not had an independent security audit.

## Review status

- **No independent audit.** An independent cryptographic audit is planned only once the project has real usage, and before any `1.0` release. Until then the version stays `0.x`.
- **Internal review (not a substitute for an audit).** An AI-assisted code review covered `src/crypto.ts`, `src/vault.ts` and `src/server.ts`. It found no flaw in the use of scrypt / AES-256-GCM (random 96-bit IV per save, header bound as AAD, 16-byte tag enforced, constant-time comparisons) or in the local server's access control (127.0.0.1 only, Host/Origin checks, single-use token, HttpOnly session). It led to one hardening change (a previous in-memory key is now zeroed if the vault is unlocked a second time).
- **Known limitations and open points:**
  - Decrypted items live in ordinary JavaScript strings, which cannot be reliably wiped from memory.
  - The minimum master password length is 8 characters; use a long passphrase.
  - Concurrent unlock requests are not rate-limited (each costs ~128 MiB), although they require a valid local session.
  - Old `*.bak-*` files created by a format migration keep the old (weaker) key-derivation settings; delete them once the new vault opens.
  - A file-system attacker can roll the vault back to an older valid copy (inherent to a single-file design).

Independent reviews are welcome: see "Reporting a vulnerability" above.
