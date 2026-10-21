# ADR 0001 · Desktop packaging with Electron

- **Status:** accepted
- **Date:** 2026-10-21

## Context

nullbrand is a Node.js backend (`src/server.ts`, `vault.ts`, `crypto.ts`) plus a browser UI served from loopback. People should get it as an app for macOS, Windows and Linux, from GitHub Releases, without installing Node.js or opening a browser themselves. The project has zero runtime dependencies and wants to keep that for the core.

## Decision

- **Technology: Electron.** The server and the UI run unchanged inside it. Chromium is the same on all three systems (the UI regression harness already runs on Chromium), and installer, signing and update tooling is mature.
- **Repository: this one.** The app is this project: the core and the UI are exactly what gets packaged. The landing page lives in its own repository.
- **Distribution: GitHub Releases only.** No package registry (see [releasing](../releasing.md)).
- **Isolation:** everything Electron-related lives in `desktop/`, with its own `package.json` and lockfile. Electron and electron-builder are development dependencies of that folder only. The root `package.json` still has `typescript` as its only dependency, and `npm run check` keeps enforcing it. Nothing in `src/` imports from `desktop/`.

### Rejected

| Option | Why not |
| --- | --- |
| Tauri | Needs Rust plus a Node sidecar or a backend rewrite; Linux WebKitGTK renders and handles the clipboard inconsistently |
| Node SEA | Single binary with no window; would need the user's browser on `localhost` |
| Neutralino, Wails, Deno/Bun compile | Swap the runtime or require a backend rewrite without giving a native window |

## How it fits together

```
desktop/main.ts       starts startServer() from the core in the Electron main process (127.0.0.1, ephemeral port), opens one window on it
desktop/security.ts   pure decisions: allowed origin, renderer settings, menu (unit-tested on plain Node)
desktop/preload.cts   sandboxed preload; exposes only { platform }
desktop/builder.yml   targets: dmg, nsis, AppImage + deb; fuses; unsigned
desktop/scripts/stage.mjs   copies the compiled core into dist/app/core, writes the app manifest
```

`npm run build` in `desktop/` builds the core (`npm --prefix .. run build`), stages it into `desktop/dist/app/core`, and compiles the shell next to it. That folder is what `npm start` runs and `npm run package` packs. Installers are written to `desktop/dist/release`; `dist/` is ignored by git.

### Hardening (all of it is in code, not just policy)

- Renderer: `contextIsolation: true`, `nodeIntegration: false` (also in workers and subframes), `sandbox: true`, `webSecurity: true`, no insecure content, no `<webview>`, spellcheck off (it would download dictionaries, an outbound connection), developer tools off in packaged builds.
- Navigation: `will-navigate` and `will-redirect` to any origin other than the local server are cancelled, `window.open` is denied, `will-attach-webview` is cancelled. Nothing is ever handed to the system browser.
- Network: every request of the window that is not the local origin (or a `data:` image) is cancelled. Permission and device requests are denied.
- Session: an in-memory partition, so the session cookie, cache and storage never reach the disk.
- CSP: the server already sends a strict policy on every response (`default-src 'none'`, same-origin scripts and styles, no inline code); the desktop shell does not loosen it.
- Single instance. Quitting by any route (window closed, menu, the UI's shutdown) closes the server first, which locks the vault, zeroes the key and clears the clipboard.
- Electron fuses in the packaged binary: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, ASAR integrity validated, app loaded only from the ASAR.
- Menu without reload or developer tools.
- Preload: a frozen object with the platform name, nothing else.

## Naming and downloads

Several projects will live under `nullbrand.dev`, each in its own repository and with its own subdomain (`pass.nullbrand.dev`, ...).

- **App identity:** `dev.nullbrand.<project>` (this one: `dev.nullbrand.pass`).
- **Installer files:** `nullbrand-<project>-<version>-<os>-<arch>.<ext>` (`os` is `mac`, `win` or `linux`), for example `nullbrand-pass-0.1.0-mac-arm64.dmg`. The project's download page picks the asset of the latest GitHub release whose name starts with `nullbrand-<project>-` and matches the visitor's system and extension (`dmg`, `exe`, `AppImage`, `deb`). Files stay on GitHub Releases, next to `SHA256SUMS`.
- The only external link the app opens is the contact page, `https://nullbrand.dev/#contact`, in the system browser. The app itself never contacts a project site on its own.

## Consequences

- Installer of roughly 90–120 MB.
- A larger build-time dependency tree, kept out of the core. `npm audit` reports advisories in that tree (build tooling); none of it is shipped in the app.
- `desktop/.npmrc` keeps `ignore-scripts=true` like the root, so the Electron binary is downloaded by an explicit step (`node node_modules/electron/install.js`, which `npm start` runs), not by an install script.
- Electron's Chromium needs security updates: the pinned versions in `desktop/package.json` have to be bumped regularly.
- The UI is reached through a loopback HTTP server, so a local process could try to talk to it. How the window authenticates (no token in a process argument, a secret other local processes do not have) is planned work (desktop authentication flow); until then the bootstrap token is in memory only, single use, as in the browser flow. Code signing and notarization are planned too; builds are unsigned.
