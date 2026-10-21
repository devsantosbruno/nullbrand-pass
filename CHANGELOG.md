# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). The version stays `0.x` until an independent security audit (see [SECURITY.md](SECURITY.md)).

## [Unreleased]

### Added
- Import by file layout, with no source to choose: `import <file.json>` (CLI), `POST /api/import` and a web dialog detect the layout from its structure. Options: destination folder and ignoring the folders of the file. A dry run (`dryRun`) shows what would be imported.
- Unencrypted `.json` export (`export <file.json> --unencrypted`, `POST /api/export`, web dialog), behind the master password and an explicit confirmation, written with mode `0600`.
- Cards are imported as cards instead of notes.
- `nullbrand/formats` subpath export.
- CI on Linux, macOS and Windows, community health files and a release guide.
- Trademark policy (`TRADEMARKS.md`) and written name-conflict review (`docs/trademark-check.md`).
- Release workflow: pushing a `vX.Y.Z` tag verifies, packs and publishes a GitHub release with `SHA256SUMS`, a Sigstore signature and a build provenance attestation. `scripts/release-notes.mjs` checks the tag against `package.json` and `CHANGELOG.md`.
- "How to verify your download" in the README, and `docs/releasing.md` with the versioning and update policy (no update checks).
- Security policy (`SECURITY.md`), CodeQL and Scorecard workflows, coverage thresholds for `crypto` and `vault`, and a package-contents check in CI.
- Tests for the real clipboard and for Windows behavior.
- Desktop app shell (`desktop/`, Electron): runs the existing server and UI in one hardened window with no external browser. `npm run package` in `desktop/` builds an unsigned installer for the host OS; installers are not part of releases yet. Decision recorded in `docs/adr/0001-desktop-packaging.md`.
- Desktop authentication: a per-launch secret held only by the app's main process is required on every request, and the vault locks on system sleep and screen lock. The browser flow of the CLI is unchanged.

### Changed
- The web interface code is split into `app.ts` (composition), `features/` (one per area) and `ui/` (reusable components: confirm dialog, popup menu, icons, reveal toggle). Same screens and behavior. `npm run check` now also rejects `innerHTML`, `eval` and inline styles under `src/web/`.
- The import response now carries `ignored` and `warnings`.
- Removed wording that positioned the project against another product, and the matching npm keyword.
- The code base is TypeScript, compiled to `dist/`, with typed API payloads and runtime guards.

### Removed
- `npx nullbrand` and `npm install -g` from the README, the CLI help and the interface messages: the project is not published to npm. Install from a GitHub release or a clone (see the README).
- The import command, route and subpath that named a specific source; use `import <file.json>` and `POST /api/import`.

### Fixed
- Copying to the clipboard on Windows no longer adds a byte order mark to the text.
- README pointed to a non-existent `public/i18n.js`; the language list lives in `src/shared/i18n.ts`.
- `SECURITY.md` referred to an e-mail address that does not exist; reports go through GitHub private vulnerability reporting.

## [0.1.0]

First version: AES-256-GCM vault with scrypt key derivation, local web interface on `127.0.0.1`, CLI, JSON import, encrypted backups and English/Portuguese localization.
