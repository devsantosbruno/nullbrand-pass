// Fails unless every installer in dist/release is signed (spec 09). Run by the release workflow after packaging; plain Node.
//   macOS:   the app inside each .dmg: valid code signature, hardened runtime, Developer ID authority, accepted by Gatekeeper as
//            notarized, ticket stapled
//   Windows: every .exe in dist/release (installer and unpacked app): valid Authenticode signature with a timestamp, and, when
//            WIN_PUBLISHER_NAME is set, a signer subject that contains it
//   Linux:   nothing to verify at OS level; the files are covered by SHA256SUMS and its signature in the release workflow
// Uses only the platform tools (codesign, spctl, stapler, hdiutil, PowerShell), run without a shell.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseDir = fileURLToPath(new URL('../dist/release/', import.meta.url));

/** Runs a tool without a shell. Returns stdout and stderr together (codesign and spctl report on stderr); throws on a non-zero exit. */
function run(file, args, env = process.env) {
  const result = spawnSync(file, args, { encoding: 'utf8', env });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error || result.status !== 0) throw new Error(`${file} ${args.join(' ')} failed:\n${output || result.error}`);
  return output;
}

function listFiles(dir, extension) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .map((name) => join(dir, name));
}

/** Files below dir whose name matches, without following symlinks (a mounted image links to /Applications) or entering a match. */
function find(dir, predicate, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (predicate(entry.name)) found.push(path);
    else if (entry.isDirectory()) find(path, predicate, found);
  }
  return found;
}

function verifyMacApp(app) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const details = run('codesign', ['-dvv', app]);
  if (!/flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/.test(details)) throw new Error(`${app}: hardened runtime is not enabled`);
  if (!/^Authority=Developer ID Application:/m.test(details)) throw new Error(`${app}: not signed with a Developer ID Application certificate`);
  if (/^TeamIdentifier=not set$/m.test(details)) throw new Error(`${app}: no team identifier`);
  if (/^Signature=adhoc$/m.test(details)) throw new Error(`${app}: ad-hoc signature`);
  const assessment = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  if (!/source=Notarized Developer ID/.test(assessment)) throw new Error(`${app}: Gatekeeper does not report it as notarized:\n${assessment}`);
  run('xcrun', ['stapler', 'validate', app]);
}

function verifyMac() {
  const images = listFiles(releaseDir, '.dmg');
  if (images.length === 0) throw new Error('no .dmg found in dist/release');
  for (const image of images) {
    const mountPoint = mkdtempSync(join(tmpdir(), 'nullbrand-verify-'));
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint, image]);
    try {
      const apps = find(mountPoint, (name) => name.endsWith('.app'));
      if (apps.length !== 1) throw new Error(`${image}: expected exactly one .app, found ${apps.length}`);
      verifyMacApp(apps[0]);
    } finally {
      run('hdiutil', ['detach', mountPoint, '-force']);
      rmSync(mountPoint, { recursive: true, force: true });
    }
    console.log(`verified: ${image}`);
  }
}

const AUTHENTICODE = [
  '$s = Get-AuthenticodeSignature -LiteralPath $env:NULLBRAND_VERIFY_FILE',
  '[pscustomobject]@{',
  '  Status = $s.Status.ToString()',
  '  Subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }',
  '  Timestamped = ($null -ne $s.TimeStamperCertificate)',
  '} | ConvertTo-Json -Compress',
].join('\n');

function verifyWindows() {
  const publisher = process.env.WIN_PUBLISHER_NAME;
  const executables = find(releaseDir, (name) => name.endsWith('.exe') && !name.startsWith('__uninstaller'));
  if (executables.length === 0) throw new Error('no .exe found in dist/release');
  for (const file of executables) {
    const output = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', AUTHENTICODE], { ...process.env, NULLBRAND_VERIFY_FILE: file });
    const signature = JSON.parse(output);
    if (signature.Status !== 'Valid') throw new Error(`${file}: signature status is ${signature.Status}`);
    if (!signature.Timestamped) throw new Error(`${file}: signature has no timestamp`);
    if (publisher && !signature.Subject?.includes(publisher)) throw new Error(`${file}: signer ${signature.Subject} is not ${publisher}`);
    console.log(`verified: ${file}`);
  }
}

const platforms = { darwin: verifyMac, win32: verifyWindows, linux: () => console.log('linux: no OS-level signature to verify') };
const verify = platforms[process.platform];
if (!verify) throw new Error(`unsupported platform ${process.platform}`);
try {
  verify();
} catch (error) {
  console.error(`verify-signatures: ${error.message}`);
  process.exitCode = 1;
}
