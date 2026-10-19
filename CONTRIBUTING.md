# Contributing

Thanks for helping. nullbrand is a small, local-only password manager, so changes are reviewed with security in mind.

## Setup

```bash
npm ci
npm run verify    # check + build + tests
```

Requires Node.js 22.14 or newer.

## Rules

- **Zero runtime dependencies.** Use Node.js built-in modules only. `typescript` is the only devDependency.
- **No escape hatches.** `scripts/check-no-escape.mjs` (run by `npm run check`) rejects them; `npm run verify` must pass.
- **Front-end (`src/web/`).** Plain TypeScript, no framework. `app.ts` only composes; each area is an `initX()` in `features/`, and `ui/` holds components that know nothing about items, the language or the state (they never import `features/` or `state.ts`). User data reaches the DOM only through `textContent` or `el()`; `npm run check` rejects `innerHTML`, `eval` and inline styles there.
- **Tests with every change.** Run on your OS; CI runs Linux, macOS and Windows.
- **Both languages.** UI and CLI text lives in `locales/en.json` and `locales/pt.json` and the tests fail if keys differ.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`...).
- **Sign off** your commits (`git commit -s`, Developer Certificate of Origin).

## Adding a language

Add `locales/<code>.json` with the same keys and placeholders as `en.json`, and register the code in `SUPPORTED` in `src/shared/i18n.ts`.

## Security

Do not open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md). Never include real vaults or backups in issues or PRs.

## Questions

Open a GitHub Discussion or issue.
