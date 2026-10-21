# Releasing

nullbrand is distributed from [npm](https://www.npmjs.com/package/nullbrand-pass), from [GitHub Releases](https://github.com/devsantosbruno/nullbrand-pass/releases) and by cloning the repository.

## Versioning

[Semantic Versioning](https://semver.org/). The version stays `0.x` until an independent security audit (see [SECURITY.md](../SECURITY.md)). While on `0.x`:

- a breaking change (CLI flags, API routes, vault format, subpath exports) raises the minor version;
- everything else raises the patch version;
- a vault written by an older release must still open in a newer one, or the changelog says how to migrate.

Tags are `vX.Y.Z` (or `vX.Y.Z-rc.1` for a pre-release, which GitHub marks as such).

## Update policy

nullbrand **never checks for updates and makes no outbound connections**. To update, install or download the new release and verify it (README, "How to verify your download"). Watch the repository's releases to be notified. An opt-in update check would change the privacy statement and needs its own decision.

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

1. refuses the release unless the tag is on `main`, is `v` + the `package.json` version, and `CHANGELOG.md` has a non-empty section for it (`scripts/release-notes.mjs`);
2. runs `npm run verify` on Linux, macOS and Windows;
3. builds the desktop installers with `desktop/builder.release.mjs` (see "Code signing" below) and verifies their signatures;
4. builds the tarball with `npm pack` and writes `SHA256SUMS` for the tarball and the installers;
5. signs `SHA256SUMS` with Sigstore (keyless, tied to this workflow's identity) and creates a build provenance attestation for every file it lists;
6. creates the GitHub release with the changelog section as notes;
7. publishes the checksummed tarball to npm with provenance (a pre-release version goes to the `next` tag, never `latest`). This is the last step: it cannot be undone, so it runs only after everything else succeeded.

A failure before step 6 publishes nothing. Fix the problem, delete the tag (`git push --delete origin vX.Y.Z` and `git tag -d vX.Y.Z`) and tag again. If only the npm step fails, the GitHub release already exists: fix the cause and re-run that job from the Actions page (do not retag). An npm version can never be published twice, and `npm unpublish` is limited, so a bad version is fixed by a new patch release and `npm deprecate`.

## npm publishing

The workflow publishes with npm [trusted publishing](https://docs.npmjs.com/trusted-publishers): npm trusts this workflow through OIDC, so there is no npm token in GitHub, and every version carries a provenance statement. One-time setup, in this order:

1. Turn on two-factor authentication (authorization and publishing) for the npm account that owns the package.
2. Publish the first version by hand, because a trusted publisher can only be added to a package that exists. Do not burn a version for it: push the first tag as usual, let the workflow build and create the GitHub release, then **reject** the pending `publish-npm` run (it waits for the `npm` environment reviewer). Download `nullbrand-pass-X.Y.Z.tgz` and `SHA256SUMS` from that release, check them (README, "How to verify your download"), and run `npm publish --access public ./nullbrand-pass-X.Y.Z.tgz` with two-factor authentication. It is the very tarball that was checksummed; only this first version lacks the npm provenance statement. (This also holds the name, see `docs/trademark-check.md`.)
3. On npmjs.com, open the package, Settings, Trusted Publisher, GitHub Actions, and enter the repository `devsantosbruno/nullbrand-pass`, the workflow `release.yml` and the environment `npm`.
4. The GitHub environment `npm` (Settings, Environments) is limited to `v*` tags and has a required reviewer, so every publish needs an approval click. It holds no secret.
5. Optionally, in the package settings, require two-factor authentication and disallow tokens, so only the workflow can publish.

The next tag publishes through the workflow. Revoking access is removing the trusted publisher in the package settings.

## Code signing

Signing is **optional and explicit**, and it is off by default because the Apple Developer program and Azure Trusted Signing are paid services. Everything else in the release path (GitHub Actions, Releases, Sigstore, npm trusted publishing, CodeQL, Dependabot) is free for a public repository. Set the repository variable `SIGN_RELEASES` to `true` (Settings, Secrets and variables, Actions, Variables) to sign: macOS and Windows installers are then signed in the release workflow and any missing credential fails the release. Without it (the default) the installers are built unsigned, the release notes say so, and nothing here needs an account. Local builds (`npm run package` in `desktop/`) always stay unsigned. `desktop/builder.release.mjs` sets `forceCodeSigning`, so a missing credential stops the build instead of producing an unsigned file, and `desktop/scripts/verify-signatures.mjs` then checks the result before anything is uploaded.

| Platform | Signing | Checked by `verify-signatures.mjs` |
| --- | --- | --- |
| macOS (`.dmg`, x64 and arm64) | Developer ID Application certificate, hardened runtime, notarized with `notarytool`, ticket stapled | valid deep signature, hardened runtime flag, Developer ID authority, Gatekeeper reports "Notarized Developer ID", `stapler validate` |
| Windows (`.exe`) | Azure Trusted Signing through OIDC, RFC 3161 timestamp | Authenticode status `Valid`, timestamp present, signer matches `WIN_PUBLISHER_NAME` |
| Linux (`.AppImage`, `.deb`) | none at OS level | covered by `SHA256SUMS`, its Sigstore signature and the build attestation (README, "How to verify your download") |

### One-time setup for signing

With `SIGN_RELEASES=true`, the macOS and Windows jobs run in a GitHub **environment** named `release-signing` (unsigned runs use an empty one, `release-unsigned`). Create it under Settings, Environments, restrict deployment to `v*` tags and add required reviewers, so a signing credential is never available to a pull request or an unreviewed run.

Secrets of the `release-signing` environment (macOS):

| Secret | Content |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | the Developer ID Application certificate and private key exported as `.p12`, base64 encoded (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CERTIFICATE_PASSWORD` | the password of that `.p12` |
| `APPLE_API_KEY_P8` | the contents of an App Store Connect API key (`AuthKey_XXXX.p8`) with the Developer role |
| `APPLE_API_KEY_ID` | the key ID of that API key |
| `APPLE_API_ISSUER` | the issuer ID shown on the App Store Connect Keys page |

Variables of the environment (public identifiers, not secrets):

| Variable | Content |
| --- | --- |
| `MAC_SIGNING_IDENTITY` | the certificate name without the `Developer ID Application:` prefix, e.g. `Jane Doe (ABCDE12345)` |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | the Microsoft Entra app registration used for OIDC |
| `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE` | the Trusted Signing region endpoint, account and certificate profile |
| `WIN_PUBLISHER_NAME` | the subject name of the certificate profile, exactly as issued |

On Azure, add a federated credential to the app registration for the subject `repo:<owner>/<repo>:environment:release-signing` and give the app the `Trusted Signing Certificate Profile Signer` role on the certificate profile only. No Windows secret is stored in GitHub. Azure Trusted Signing needs an eligible organization or individual identity validation; if it is not available, an OV or EV certificate is the alternative (a cloud HSM service, since EV keys cannot be exported) and needs a different Windows job.

### Rotation and revocation

- **Developer ID certificate** (valid 5 years): create a new certificate in the Apple Developer account, export it as `.p12`, update the two `MAC_CERTIFICATE_*` secrets and `MAC_SIGNING_IDENTITY`, cut a patch release, then revoke the old certificate only if it may have leaked (notarized apps stay valid after expiry, a revoked certificate invalidates them).
- **App Store Connect API key**: create a new key, update the three `APPLE_API_*` secrets, revoke the old key. Rotate at least once a year and whenever someone with access leaves.
- **Azure**: there is nothing to rotate for the workflow itself (OIDC, no secret). Certificates of the profile are short-lived and renewed by Azure; the timestamp keeps older signatures valid.
- **After a suspected leak**: revoke first (certificate, API key, or the federated credential), then rotate, then look at the Actions runs and the Apple and Azure audit logs since the last known good release, and say so in a security advisory.

Signing material never appears in the repository or in logs: secrets reach only the steps that use them, through `env`, never in a command line. The API key is written to a `0600` file in the runner's temp directory and deleted at the end of the job.
