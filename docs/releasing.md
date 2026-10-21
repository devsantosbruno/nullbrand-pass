# Releasing

nullbrand is distributed from [GitHub Releases](https://github.com/devsantosbruno/nullbrand-pass/releases) and by cloning the repository. It is not published to npm.

## Versioning

[Semantic Versioning](https://semver.org/). The version stays `0.x` until an independent security audit (see [SECURITY.md](../SECURITY.md)). While on `0.x`:

- a breaking change (CLI flags, API routes, vault format, subpath exports) raises the minor version;
- everything else raises the patch version;
- a vault written by an older release must still open in a newer one, or the changelog says how to migrate.

Tags are `vX.Y.Z` (or `vX.Y.Z-rc.1` for a pre-release, which GitHub marks as such).

## Update policy

nullbrand **never checks for updates and makes no outbound connections**. To update, download the new release and verify it (README, "How to verify your download"). Watch the repository's releases to be notified. An opt-in update check would change the privacy statement and needs its own decision.

## Cutting a release

1. In `CHANGELOG.md`, rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, add a fresh empty `[Unreleased]` above it.
2. Set `"version": "X.Y.Z"` in `package.json` (and `package-lock.json`: `npm version X.Y.Z --no-git-tag-version`).
3. `npm run verify`, then open a pull request. Merge it to `main`.
4. Tag the merge commit and push the tag:

   ```bash
   git tag -s vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

Nothing else is manual. `.github/workflows/release.yml`:

1. runs `npm run verify` on Linux, macOS and Windows;
2. refuses the release unless the tag is on `main`, is `v` + the `package.json` version, and `CHANGELOG.md` has a non-empty section for it (`scripts/release-notes.mjs`);
3. builds the tarball with `npm pack` and writes `SHA256SUMS`;
4. signs `SHA256SUMS` with Sigstore (keyless, tied to this workflow's identity) and creates a build provenance attestation for the tarball;
5. creates the GitHub release with the changelog section as notes.

A failed run publishes nothing. Fix the problem, delete the tag (`git push --delete origin vX.Y.Z` and `git tag -d vX.Y.Z`) and tag again.

## Not yet covered

Desktop installers can be built locally (`npm run package` in `desktop/`, unsigned; see [ADR 0001](adr/0001-desktop-packaging.md)) but are not part of the release workflow yet. When they do, they go into the `build` job, get signed and notarized with the platform tools, and are listed in `SHA256SUMS` so the same verification covers them.
