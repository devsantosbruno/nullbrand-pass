# nullbrand

**100% local** password manager. No account, no cloud, no external server: the vault is an encrypted file on your computer.

```bash
npx nullbrand
```

> **Status: new project, no independent security audit.** It is open source (MIT) and provided "as is", without warranty. For critical data, keep encrypted backups and consider an established, audited password manager. Not affiliated with or endorsed by Bitwarden; "Bitwarden" is only named to describe the import format.

The command starts a web interface **on `127.0.0.1` only** and opens your browser. The first time, you create the master password; after that you just unlock.

## Features

- Vault encrypted with **AES-256-GCM** and a key derived by **scrypt** (N=2¹⁷, r=8, p=1)
- Logins (username, password, sites, folder, favorite, notes), cards, identities, SSH keys and secure notes
- Search, filters and folders
- Password generator with uniform sampling (`crypto.randomInt`)
- **Bitwarden import** (unencrypted `.json` export — logins, notes and identities; cards become notes)
- **Encrypted backup** (export and restore/merge)
- Master password change
- Full CLI for those who prefer the terminal
- **English and Portuguese** (`en`, `pt`) in the web interface and the CLI
- **Zero dependencies**: Node.js built-in modules only

## Requirements

Node.js 22.14 or newer. CI runs `npm run verify` on Linux, macOS and Windows with Node 22.14.0 and the current LTS.

Linux: copying to the clipboard needs `xclip`, `xsel` or `wl-clipboard` installed.

Limitation: hiding the password as you type relies on a private, undocumented readline method (`_writeToOutput`). If a future Node release removes it, the password prompt refuses to run (`err.prompt.cannotMask`) instead of echoing the password; the test `contract: readline still exposes the private _writeToOutput` fails early when that happens.

## CLI usage

```bash
npx nullbrand                     # web interface (default)
npx nullbrand init                # creates the vault from the terminal
npx nullbrand list [query]        # lists items
npx nullbrand get github          # copies the password and clears the clipboard after 30 s (--clear <s>, 0 = never clear)
npx nullbrand get github --show   # prints the password
npx nullbrand add                 # adds a login
npx nullbrand rm github           # removes an item
npx nullbrand generate -l 32      # generates a password
npx nullbrand import bitwarden ~/Downloads/bitwarden_export.json
npx nullbrand import backup backup.json
npx nullbrand export backup.json  # encrypted backup
npx nullbrand passwd              # changes the master password
npx nullbrand where               # shows where the vault is stored
```

Web interface options: `--port <n>`, `--idle <min>` (auto-lock on inactivity, default 15; `0` disables it) and `--no-open`.

General options: `--vault <path>` and `--lang <en|pt>`.

Command-line flags:

- `--x=a=b` splits at the first `=` only, so `--vault=/tmp/a=b.json` works.
- An option that takes a value (`--port`, `--idle`, `--vault`, `--length`/`-l`, `--clear`, `--lang`) fails with an error when the value is missing, i.e. it is the last argument or the next one starts with `--`.
- An unknown option (a typo such as `--prot`) prints a warning on stderr and is ignored; the command still runs.
- `--no-<option>` turns a switch off (`--no-open`, `--no-digits`). On options that take a value it sets `false`, which only `--no-clear` gives a meaning to (0 = never clear); the others behave as if the option was not given.

To install permanently: `npm install -g nullbrand` and just use `nullbrand`.

Releases are tagged `vX.Y.Z` and listed in [CHANGELOG.md](CHANGELOG.md). nullbrand never checks for updates.

## Language

nullbrand speaks English (`en`) and Portuguese (`pt`). The language is picked from the first of these that has a valid value:

1. `--lang en` or `--lang pt` on the command line
2. the `NULLBRAND_LANG` environment variable
3. the choice saved in `~/.nullbrand/config.json` (field `lang`)
4. the system locale (`Intl.DateTimeFormat().resolvedOptions().locale` in Node, `navigator.language` in the browser); any `pt-*` becomes `pt`
5. `en`

An invalid value is skipped and the next level is used. For the flag and the variable, a short warning is printed to the terminal.

```bash
npx nullbrand --lang pt
NULLBRAND_LANG=pt npx nullbrand get github
```

**Where the choice is saved.** The EN | PT switch in the web interface (also on the unlock screen) writes `{ "lang": "pt" }` to `config.json` in the data folder (`~/.nullbrand/config.json`, or `$NULLBRAND_HOME/config.json`). The file sits outside the encrypted vault so the unlock screen can open in the right language before the master password is typed. It is created only when you pick a language: an auto-detected language is never written. Other fields in the file are kept. `--vault` does not move it.

The texts live in `locales/en.json` and `locales/pt.json` (flat keys, `{name}` placeholders, `_one`/`_other` plural suffixes). The CLI and the web interface read the same files. To add a language, add `locales/<code>.json` with the same keys and register the code in `SUPPORTED` in `src/shared/i18n.ts`; the tests fail if a key or placeholder is missing.

## Where the data lives

`~/.nullbrand/vault.json` (on Windows, `C:\Users\<you>\.nullbrand\vault.json`).

Change it with the `NULLBRAND_HOME` variable or with `--vault <path>`.

The file has a plain-text header (format, version, scrypt parameters and salt) and the entire content encrypted — **including item names**. The header is used as GCM authenticated data (AAD), so changing the parameters invalidates the file. Writes are atomic (temporary file + rename) and the file is created with `600` permissions.

**Other users on the same computer.** The data directory is `0700` and the files `0600`, set at creation time (independent of umask); on startup, more open permissions are fixed with a warning, and a directory/vault owned by another user is refused. The server only listens on 127.0.0.1 and every route, including static files, requires the session cookie. Passwords reach the clipboard only through stdin. Limitations: the access link (single-use token, 60 s) briefly appears in the process list when the browser is opened; on Windows there is no `chmod` and isolation comes from the profile ACLs (`%USERPROFILE%`), so don't point `NULLBRAND_HOME`/`--vault` at shared folders.

> **There is no password recovery.** If you forget the master password, the vault cannot be opened. Make backups.

## Security model

| Threat | Protection |
| --- | --- |
| Someone on the local network | The server only listens on `127.0.0.1` and refuses to start on any other address |
| Malicious site open in the browser | The browser opens `/auth?t=<token>` (32 random bytes, single-use, expires in 60 s); the server exchanges the token for an `HttpOnly; SameSite=Strict` session cookie and redirects to `/`. The token is not printed to the terminal (only if the browser doesn't open, over SSH/WSL/no display, or with `--print-url`). `Host` and `Origin` are validated on every request (blocks DNS rebinding and CSRF), there is no CORS, and locking the vault or quitting drops the session (to come back, run `npx nullbrand` again) |
| XSS / third-party scripts | CSP `default-src 'none'`, no external resources, data always rendered with `textContent` |
| Leaving the vault open | Automatic lock on inactivity (15 min); the key lives only in memory and is zeroed on lock |
| Theft of the vault file | Brute force is limited by scrypt's cost (~128 MiB per attempt) — use a long master password |
| Forgotten copied password | Copying is done by the Node process (password via stdin, never in arguments). After 30 s (`--clear <s>`), on lock and on quit, the clipboard is only cleared if it still contains the password (SHA-256 comparison). On macOS the copy is marked as sensitive for clipboard history managers |

**Privacy:** nullbrand has no telemetry, no analytics, no update checks and makes no outbound network connections. The only listening socket is `127.0.0.1`. It collects nothing, so there is no personal data to process or share.

**Reporting a vulnerability:** see [SECURITY.md](SECURITY.md).

**Out of scope:** malware running as your user (it can read memory or capture the keyboard) and other local processes of the same user that can read the terminal link.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

```bash
npm test          # tests (node:test)
npm run dev       # rebuilds, then opens the UI on ./dev-vault.json (separate from your real vault), no auto-lock
```

`npx nullbrand` runs the published package (or the existing `dist/` inside the repo, **without rebuilding**).
To test source changes, use `npm run dev` or run `npm run build` first.

Structure (TypeScript, compiled to `dist/` by `npm run build`):

```
bin/nullbrand.ts            npx entry point
src/crypto.ts               scrypt + AES-256-GCM
src/vault.ts                vault file and item operations
src/generator.ts            password generator
src/sshkey.ts               SSH key generation and inspection
src/clipboard.ts            clipboard with automatic clearing
src/importers/bitwarden.ts  Bitwarden import
src/server.ts               local HTTP server and API
src/cli.ts                  CLI commands
src/i18n.ts                 language resolution, config.json (Node side)
src/shared/                 code shared by Node and the browser (types, guards, i18n)
src/web/                    web interface logic (app.ts)
static/                     index.html, styles.css, favicon.svg
locales/                    en.json, pt.json (shared by the CLI and the UI)
```

## License

[MIT](LICENSE). The name is covered by the [trademark policy](TRADEMARKS.md); forks should use their own name. Name-conflict review: `docs/trademark-check.md`.
