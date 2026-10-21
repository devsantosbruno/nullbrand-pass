# nullbrand

**100% local** password manager. No account, no cloud, no external server: the vault is an encrypted file on your computer.

> **Status: new project, no independent security audit.** It is open source (MIT) and provided "as is", without warranty. For critical data, keep encrypted backups and consider an established, audited password manager. Not affiliated with or endorsed by any other password manager.

## Install

Get it in one of three ways (the CLI needs Node.js 22.14 or newer):

- **From npm.** The package is published from this repository's release workflow with [provenance](https://docs.npmjs.com/generating-provenance-statements), so its npm page links to the exact commit and build. Run it once, or install it:

  ```bash
  npx nullbrand-pass@X.Y.Z
  npm install --global nullbrand-pass@X.Y.Z
  ```

  Pin the version you checked (replace `X.Y.Z`); `npx nullbrand-pass` alone runs whatever is newest. See [How to verify your download](#how-to-verify-your-download).
- **Download a release** from [GitHub Releases](https://github.com/devsantosbruno/nullbrand-pass/releases) and [verify it](#how-to-verify-your-download). Releases include the desktop installers (macOS `.dmg`, Windows `.exe`, Linux `.AppImage` and `.deb`) and the packaged CLI, installed with `npm install -g ./nullbrand-pass-X.Y.Z.tgz`. Desktop installers are code-signed only when the release notes say so; an unsigned one makes macOS or Windows warn when you open it (macOS: System Settings, Privacy & Security, "Open Anyway"; Windows: "More info", "Run anyway"). Check it against `SHA256SUMS` first.
- **Clone the repository:**

  ```bash
  git clone https://github.com/devsantosbruno/nullbrand-pass.git
  cd nullbrand-pass
  npm ci
  npm run build
  node dist/bin/nullbrand.js
  ```

  `npm link` in the clone makes the `nullbrand-pass` command available everywhere.

Below, `nullbrand-pass` stands for whichever way you run it.

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
nullbrand-pass                     # web interface (default)
nullbrand-pass init                # creates the vault from the terminal
nullbrand-pass list [query]        # lists items
nullbrand-pass get github          # copies the password and clears the clipboard after 30 s (--clear <s>, 0 = never clear)
nullbrand-pass get github --show   # prints the password
nullbrand-pass add                 # adds a login
nullbrand-pass rm github           # removes an item
nullbrand-pass generate -l 32      # generates a password
nullbrand-pass import ~/Downloads/passwords.json    # the layout is detected
nullbrand-pass import backup backup.json
nullbrand-pass export backup.json                   # encrypted backup
nullbrand-pass export out.json --unencrypted        # plain text: asks for the master password
nullbrand-pass passwd              # changes the master password
nullbrand-pass where               # shows where the vault is stored
```

Web interface options: `--port <n>`, `--idle <min>` (auto-lock on inactivity, default 15; `0` disables it) and `--no-open`.

General options: `--vault <path>` and `--lang <en|pt>`.

Command-line flags:

- `--x=a=b` splits at the first `=` only, so `--vault=/tmp/a=b.json` works.
- An option that takes a value (`--port`, `--idle`, `--vault`, `--length`/`-l`, `--clear`, `--lang`) fails with an error when the value is missing, i.e. it is the last argument or the next one starts with `--`.
- An unknown option (a typo such as `--prot`) prints a warning on stderr and is ignored; the command still runs.
- `--no-<option>` turns a switch off (`--no-open`, `--no-digits`). On options that take a value it sets `false`, which only `--no-clear` gives a meaning to (0 = never clear); the others behave as if the option was not given.

Releases are tagged `vX.Y.Z` and listed in [CHANGELOG.md](CHANGELOG.md). nullbrand never checks for updates: to update, download the new release and [verify it](#how-to-verify-your-download). The versioning and release process is in [docs/releasing.md](docs/releasing.md).

## How to verify your download

Every [release](https://github.com/devsantosbruno/nullbrand-pass/releases) ships its files (the tarball and the installers), a `SHA256SUMS` file listing them, and `SHA256SUMS.sigstore.json`, a [Sigstore](https://www.sigstore.dev/) signature made by the release workflow itself (no key to manage or trust). Download the file you want, `SHA256SUMS` and the signature into one folder and replace `X.Y.Z` with the version.

1. **Check the signature** (needs [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 2.x). It proves `SHA256SUMS` was produced by this repository's release workflow for that tag:

   ```bash
   cosign verify-blob SHA256SUMS \
     --bundle SHA256SUMS.sigstore.json \
     --certificate-identity "https://github.com/devsantosbruno/nullbrand-pass/.github/workflows/release.yml@refs/tags/vX.Y.Z" \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com
   ```

2. **Check the file against the checksums:**

   ```bash
   sha256sum --check --ignore-missing SHA256SUMS      # Linux
   shasum -a 256 --check --ignore-missing SHA256SUMS  # macOS
   ```

   On Windows (PowerShell), compare `(Get-FileHash nullbrand-pass-X.Y.Z.tgz).Hash` with the line in `SHA256SUMS` (case-insensitive).

3. **Optional, build provenance** (needs the [GitHub CLI](https://cli.github.com/)):

   ```bash
   gh attestation verify nullbrand-pass-X.Y.Z.tgz --repo devsantosbruno/nullbrand-pass
   ```

**The npm package** is the same tarball that `SHA256SUMS` lists. To check what npm served you, run `npm pack nullbrand-pass@X.Y.Z` and compare the `.tgz` with its line in `SHA256SUMS`, and run `npm audit signatures` in a project that depends on it to verify the registry signature and the provenance statement.

Do not run anything from a download that fails one of these checks.

## Import and export

Both use a `.json` file and say nothing about which app wrote or will read it.

```bash
nullbrand-pass import file.json                    # the layout is detected
nullbrand-pass import file.json --folder Imported  # everything goes into the folder "Imported"
nullbrand-pass import file.json --ignore-folders   # drop the folders written in the file
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

nullbrand-pass speaks English (`en`) and Portuguese (`pt`). The language is picked from the first of these that has a valid value:

1. `--lang en` or `--lang pt` on the command line
2. the `NULLBRAND_LANG` environment variable
3. the choice saved in `~/.nullbrand/config.json` (field `lang`)
4. the system locale (`Intl.DateTimeFormat().resolvedOptions().locale` in Node, `navigator.language` in the browser); any `pt-*` becomes `pt`
5. `en`

An invalid value is skipped and the next level is used. For the flag and the variable, a short warning is printed to the terminal.

```bash
nullbrand-pass --lang pt
NULLBRAND_LANG=pt nullbrand-pass get github
```

**Where the choice is saved.** The EN | PT switch in the web interface (also on the unlock screen) writes `{ "lang": "pt" }` to `config.json` in the data folder (`~/.nullbrand/config.json`, or `$NULLBRAND_HOME/config.json`). The file sits outside the encrypted vault so the unlock screen can open in the right language before the master password is typed. It is created only when you pick a language: an auto-detected language is never written. Other fields in the file are kept. `--vault` does not move it.

The texts live in `locales/en.json` and `locales/pt.json` (flat keys, `{name}` placeholders, `_one`/`_other` plural suffixes). The CLI and the web interface read the same files. To add a language, add `locales/<code>.json` with the same keys and register the code in `SUPPORTED` in `src/shared/i18n.ts`; the tests fail if a key or placeholder is missing.

## Where the data lives

`~/.nullbrand/vault.json` (on Windows, `C:\Users\<you>\.nullbrand\vault.json`).

Change it with the `NULLBRAND_HOME` variable or with `--vault <path>`.

The file has a plain-text header (format, version, scrypt parameters and salt) and the entire content encrypted — **including item names**. The header is used as GCM authenticated data (AAD), so changing the parameters invalidates the file. Writes are atomic (temporary file + rename) and the file is created with `600` permissions.

**Other users on the same computer.** The data directory is `0700` and the files `0600`, set at creation time (independent of umask); on startup, more open permissions are fixed with a warning, and a directory/vault owned by another user is refused. The server only listens on 127.0.0.1 and every route, including static files, requires the session cookie. Passwords reach the clipboard only through stdin. Limitations: in the browser (CLI) flow the access link (single-use token, 60 s) briefly appears in the process list when the browser is opened (the desktop app has no such link in any process argument); on Windows there is no `chmod` and isolation comes from the profile ACLs (`%USERPROFILE%`), so don't point `NULLBRAND_HOME`/`--vault` at shared folders.

> **There is no password recovery.** If you forget the master password, the vault cannot be opened. Make backups.

## Security model

| Threat | Protection |
| --- | --- |
| Someone on the local network | The server only listens on `127.0.0.1` and refuses to start on any other address |
| Malicious site open in the browser | The browser opens `/auth?t=<token>` (32 random bytes, single-use, expires in 60 s); the server exchanges the token for an `HttpOnly; SameSite=Strict` session cookie and redirects to `/`. The token is not printed to the terminal (only if the browser doesn't open, over SSH/WSL/no display, or with `--print-url`). `Host` and `Origin` are validated on every request (blocks DNS rebinding and CSRF), there is no CORS, and locking the vault or quitting drops the session (to come back, run `nullbrand` again) |
| Other local processes or users, and web pages, against the desktop app | The app opens no external browser and passes nothing through a process argument. Each launch makes a random 256-bit secret that exists only in the app's main process: the window gets it from a request hook (never from the page) and the server answers 403 to every route, `/auth` and static files included, when it is missing or wrong. The single-use token, `HttpOnly; SameSite=Strict` cookie and `Host`/`Origin` checks still apply on top, the server still listens on `127.0.0.1` on a random port, and a regular browser cannot reach the app (it cannot send the secret, and there is no CORS). The vault locks and the window reloads to the unlock screen on system sleep and screen lock; closing the window quits the app and locks the vault. Minimizing does not lock (the 15 min inactivity lock applies) |
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

`node dist/bin/nullbrand.js` runs the existing `dist/` **without rebuilding**.
To test source changes, use `npm run dev` or run `npm run build` first.

Structure (TypeScript, compiled to `dist/` by `npm run build`):

```
bin/nullbrand.ts            CLI entry point
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
