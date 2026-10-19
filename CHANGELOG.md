# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). The version stays `0.x` until an independent security audit (see [SECURITY.md](SECURITY.md)).

## [Unreleased]

### Added
- CI on Linux, macOS and Windows, community health files and a release guide.
- Trademark policy (`TRADEMARKS.md`) and written name-conflict review (`docs/trademark-check.md`).

### Changed
- Removed "Bitwarden-style" wording and the `bitwarden` npm keyword; Bitwarden is named only to describe the import format.

### Fixed
- README pointed to a non-existent `public/i18n.js`; the language list lives in `src/shared/i18n.ts`.
- `SECURITY.md` referred to an e-mail address that does not exist; reports go through GitHub private vulnerability reporting.

## [0.1.0]

First version: AES-256-GCM vault with scrypt key derivation, local web interface on `127.0.0.1`, CLI, Bitwarden import, encrypted backups and English/Portuguese localization.
