# nullbrand

**100% local** password manager. No account, no cloud, no external server: the vault is an encrypted file on your computer.

```bash
npx nullbrand
```

> **Status: new project, no independent security audit.** It is open source (MIT) and provided "as is", without warranty. For critical data, keep encrypted backups and consider an established, audited password manager. Not affiliated with or endorsed by any other password manager.

The command starts a web interface **on `127.0.0.1` only** and opens your browser. The first time, you create the master password; after that you just unlock.

## Features

- Vault encrypted with **AES-256-GCM** and a key derived by **scrypt** (N=2¹⁷, r=8, p=1)
- Logins (username, password, sites, folder, favorite, notes), cards, identities, SSH keys and secure notes
- Search, filters and folders
- Password generator with uniform sampling (`crypto.randomInt`)
- **Import from a `.json` file** (the layout is detected; see [Import and export](#import-and-export))
- **Export** as an encrypted backup, or as an unencrypted `.json` file
- **Encrypted backup** (restore/merge)
- Master password change
- Full CLI for those who prefer the terminal
- **English and Portuguese** (`en`, `pt`) in the web interface and the CLI
- **Zero dependencies**: Node.js built-in modules only

## Requirements

Node.js 22.14 or newer. CI runs `npm run verify` and the real-clipboard tests on every push and pull request:

| OS (runner) | Node |
| --- | --- |
| Linux (`ubuntu-latest`, X11 via xvfb + xclip) | 22.14.0, current LTS |
| macOS (`macos-latest`) | 22.14.0, current LTS |
| Windows (`windows-latest`) | 22.14.0, current LTS |

Wayland (`wl-clipboard`) and `xsel` are covered by unit tests with a fake command runner only.

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
npx nullbrand import ~/Downloads/passwords.json    # the layout is detected
npx nullbrand import backup backup.json
npx nullbrand export backup.json                   # encrypted backup
npx nullbrand export out.json --unencrypted        # plain text: asks for the master password
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

## Import and export

Both use a `.json` file and say nothing about which app wrote or will read it.

```bash
npx nullbrand import file.json                    # the layout is detected
npx nullbrand import file.json --folder Imported  # everything goes into the folder "Imported"
npx nullbrand import file.json --ignore-folders   # drop the folders written in the file
```

- **Detection.** The layout of the file is recognised from its structure, never from a name. A file that no layout is sure about fails with "not in a supported format": it is never guessed. An encrypted export from another app is refused with a message to export it again unencrypted.
- **Folders.** With `--folder Dest`, folders of the file become `Dest/Folder` (a flat name: `/` is a naming convention, not a hierarchy) and items without a folder go directly into `Dest`. With `--ignore-folders` everything goes into `Dest`, or has no folder.
- **Limits.** 25 MiB per file. The web interface accepts bodies up to 10 MB.
- **Duplicates** are skipped; existing items are never updated.

In the web interface, *Import and backup → Choose a file…* shows how many items were found, and any warning, before anything is imported.

Export has two choices:

| Output | Protection | Readable by |
|---|---|---|
| Backup `.json` | Encrypted with your master password | nullbrand only |
| `.json` | **Plain text** | anything that can read the nested layout nullbrand writes |

An unencrypted export asks for the master password again and an explicit confirmation (`--i-understand`, or a y/N answer; a checkbox in the web interface), and the file is created with mode `0600`. Delete it as soon as you no longer need it. Fields the layout has no place for (SSH keys, RG, PIS, CNPJ, birth date) are written into the item's notes as `key: value` lines, and the export tells you about them.

Only `.json` is read. Other formats and encrypted databases are not supported: they would need cryptography and parsers that cannot be written on Node's built-ins alone, and the project has no runtime dependencies.

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
| Forgotten copied password | Copying is done by the Node process (password via stdin, never in arguments). After 30 s (`--clear <s>`), on lock and on quit, the clipboard is only cleared if it still contains the password (SHA-256 comparison). On macOS the copy is marked as sensitive for clipboard history managers; on Windows it is not (see [SECURITY.md](SECURITY.md)) |

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
src/formats/                import / export: adapters, detection, writers
src/server.ts               local HTTP server and API
src/cli.ts                  CLI commands
src/i18n.ts                 language resolution, config.json (Node side)
src/shared/                 code shared by Node and the browser (types, guards, i18n)
src/web/                    browser code: app.ts (composition), features/ (one per area), ui/ (reusable components)
static/                     index.html, styles.css, favicon.svg
locales/                    en.json, pt.json (shared by the CLI and the UI)
```

## License

[MIT](LICENSE). The name is covered by the [trademark policy](TRADEMARKS.md); forks should use their own name. Name-conflict review: `docs/trademark-check.md`.
