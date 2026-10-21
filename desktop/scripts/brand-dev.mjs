// Development only: `electron dist/app` would run the stock Electron.app, whose Dock label and icon come from its own bundle (name,
// icon and executable name). This builds dist/dev/<name>.app, a renamed copy with the app's name and icon, and prints nothing else;
// `npm start` runs it. Packaged builds do not need it: electron-builder reads productName and build/icon.png. macOS only.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rename, rm, copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const here = fileURLToPath(new URL('../', import.meta.url));
const NAME = 'nullbrand pass';
const source = join(here, 'node_modules', 'electron', 'dist', 'Electron.app');
const outDir = join(here, 'dist', 'dev');
const bundle = join(outDir, `${NAME}.app`);
const plist = join(bundle, 'Contents', 'Info.plist');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
execFileSync('cp', ['-R', source, bundle]);
await rename(join(bundle, 'Contents', 'MacOS', 'Electron'), join(bundle, 'Contents', 'MacOS', NAME));

const set = (key, type, value) => {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist]);
  }
};
set('CFBundleName', 'string', NAME);
set('CFBundleDisplayName', 'string', NAME);
set('CFBundleExecutable', 'string', NAME);
set('CFBundleIdentifier', 'string', 'dev.nullbrand.pass.dev');

const tmp = await mkdtemp(join(tmpdir(), 'brand-'));
try {
  const iconset = join(tmp, 'icon.iconset');
  await mkdir(iconset);
  const png = join(here, 'build', 'icon.png');
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', size, size, png, '--out', join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
    execFileSync('sips', ['-z', size * 2, size * 2, png, '--out', join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
  }
  const icns = join(tmp, 'icon.icns');
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
  await copyFile(icns, join(bundle, 'Contents', 'Resources', 'electron.icns'));
} finally {
  await rm(tmp, { recursive: true, force: true });
}

// Editing the bundle breaks its ad-hoc signature, and an unsigned arm64 binary is killed at launch.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'ignore' });
console.log(`brand-dev: ${bundle}`);
