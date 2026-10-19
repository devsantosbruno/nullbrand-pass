# Trademark check: "nullbrand"

Written conclusion for spec 03. Last reviewed: 2026-10-18.

This is an engineering check, not legal advice. Items marked **Pending** need a person to run them in a database that has no public API.

## Conclusion

- **No conflict found** for "nullbrand" in the sources that could be queried without a login (npm, GitHub, Homebrew, web search).
- **Official trademark databases are still unchecked.** USPTO, EUIPO and INPI Brazil must be searched by hand before the first signed installer (spec 09). Until then the name is used as an unregistered mark with no clearance.
- **Decision: do not register the mark yet.** Reassess before `1.0` or before the first signed installer, whichever comes first. Usage rules for forks are in [TRADEMARKS.md](../TRADEMARKS.md).
- **Third-party names.** The project names no other product: positioning wording and the matching npm keyword were removed, and import is by file structure (spec 04). The non-affiliation disclaimer stays in the README.
- **Distribution:** the desktop app, when it exists, will be a free download from the project site. It will not be listed in app stores or package managers, so store identifiers (reverse-DNS app ID, Flathub, winget) are out of scope.

## Name availability

| Place | Result (2026-10-18) | Status |
| --- | --- | --- |
| npm `nullbrand` | Not found in the registry (unpublished); the name is free | Available. Publish `0.1.0` to hold it. |
| npm `nullbrand-pass` | Not found | Available |
| GitHub user/org `nullbrand` | Not found | Available. Repo today: `devsantosbruno/nullbrand-pass`. |
| Domain `nullbrand.com` | Registered 2026-07-31, expires 2027-07-31 | Owned by the maintainer. Turn on auto-renew. |
| Homebrew formula and cask `nullbrand` | Not found | Available |
| Web search for "nullbrand" with software/password terms | No product or company found | No conflict seen |

## Trademark databases

| Office | Search | Status |
| --- | --- | --- |
| USPTO | Trademark Search, classes 9 and 42 | **Pending** |
| EUIPO | eSearch plus, classes 9 and 42 | **Pending** |
| INPI Brazil | Busca de marcas, classes 9 and 42 | **Pending** |
| WIPO | Global Brand Database | **Pending** |

Search the exact word and close variants (`null brand`, `nullbrand`, `nul brand`, `nulbrand`). Record each result with its date here.

## Use of third-party names

Rule: none. No product names in code, UI, CLI, API, locales or docs; no logos, brand colors or product imagery; no wording that suggests endorsement or compatibility certification.

`scripts/trademark-usage.test.mjs` fails if a third-party product name appears in the shipped sources, the README or `package.json`, or if a brand asset is added to `static/`.

## Pending actions for the maintainer

1. Run the database searches above and paste the results in this file.
2. Publish `0.1.0` to npm to claim the name, and create the `nullbrand` GitHub org if wanted.
3. Turn on auto-renew for `nullbrand.com`.
4. Reassess registration before `1.0` or the first signed installer.
