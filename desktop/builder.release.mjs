// Release configuration: builder.yml plus code signing (spec 09). Only the release workflow uses it (`npm run package:release`);
// local builds keep using builder.yml and stay unsigned.
// No signing material lives here. Certificates and credentials come from the environment of the release workflow. The variables read
// below are public identifiers (certificate name, publisher, endpoint) kept as repository variables, not secrets. A missing one stops
// the build, and forceCodeSigning makes electron-builder fail instead of producing an unsigned binary.
// This file is read by electron-builder only: it does not take part in the TypeScript build.

/** @param {string} name */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`builder.release: the environment variable ${name} is not set. Releases are signed; see docs/releasing.md.`);
  }
  return value;
}

const signing = {
  // macOS: Developer ID Application certificate, imported by electron-builder into a temporary keychain from CSC_LINK and
  // CSC_KEY_PASSWORD. Notarization (notarytool) and stapling use the App Store Connect API key in APPLE_API_KEY, APPLE_API_KEY_ID and
  // APPLE_API_ISSUER; electron-builder skips notarization silently when they are missing, so the workflow checks them and
  // scripts/verify-signatures.mjs checks the stapled ticket afterwards.
  darwin: () => ({
    mac: {
      // The certificate name without the "Developer ID Application:" prefix, e.g. "Jane Doe (ABCDE12345)".
      identity: required('MAC_SIGNING_IDENTITY'),
      hardenedRuntime: true,
      gatekeeperAssess: false,
      notarize: true,
      target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    },
  }),
  // Windows: Azure Trusted Signing. The workflow signs in to Azure with OIDC, so there is no certificate or client secret to store.
  // Files are timestamped (RFC 3161), which keeps the signature valid after the certificate expires.
  win32: () => ({
    win: {
      azureSignOptions: {
        endpoint: required('AZURE_TRUSTED_SIGNING_ENDPOINT'),
        codeSigningAccountName: required('AZURE_TRUSTED_SIGNING_ACCOUNT'),
        certificateProfileName: required('AZURE_TRUSTED_SIGNING_PROFILE'),
        publisherName: required('WIN_PUBLISHER_NAME'),
        timestampRfc3161: 'http://timestamp.acs.microsoft.com',
      },
    },
  }),
  // Linux has no OS-level signing: the files are covered by SHA256SUMS, its Sigstore signature and the build attestation.
  linux: () => ({}),
};

const platformSigning = signing[process.platform];
if (platformSigning === undefined) throw new Error(`builder.release: unsupported platform ${process.platform}`);

export default {
  extends: 'builder.yml',
  forceCodeSigning: true,
  electronFuses: {
    // An ad-hoc signature is only a stand-in for unsigned builds; the real signature is applied after the fuses are flipped.
    resetAdHocDarwinSignature: false,
  },
  ...platformSigning(),
};
