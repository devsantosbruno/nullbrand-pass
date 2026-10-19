// Build helper, plain Node.
//   node scripts/copy-assets.mjs clean   removes dist/ (run before tsc -b so nothing stale survives)
//   node scripts/copy-assets.mjs copy    copies what tsc does not emit into dist/ (run after tsc -b)
// The compiled code resolves '../package.json', '../locales/' and '../public/' relative to dist/src/, hence this layout:
//   dist/package.json   from package.json, always overwritten so the version is never stale
//   dist/locales/       from locales/
//   dist/public/        from static/, plus the compiled shared modules the browser imports
//   dist/test/fixtures/ from test/fixtures/, which the compiled tests read relative to their own file
import { cp, mkdir, readdir, rm, chmod, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const mode = process.argv[2];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function mustExist(path, what) {
  if (!(await exists(path))) throw new Error(`copy-assets: ${what} not found at ${path} (did tsc -b run?)`);
}

if (mode === 'clean') {
  await rm(dist, { recursive: true, force: true });
} else if (mode === 'copy') {
  await mkdir(dist, { recursive: true });
  await mustExist(join(dist, 'bin', 'nullbrand.js'), 'bin/nullbrand.js');
  await cp(join(root, 'package.json'), join(dist, 'package.json'));
  await cp(join(root, 'locales'), join(dist, 'locales'), { recursive: true });
  if (await exists(join(root, 'static'))) await cp(join(root, 'static'), join(dist, 'public'), { recursive: true });
  // The browser imports './i18n.js' and its dependencies next to app.js, so copy every compiled shared module flat.
  const sharedDir = join(dist, 'src', 'shared');
  await mustExist(join(sharedDir, 'i18n.js'), 'compiled shared/i18n.js');
  await mkdir(join(dist, 'public'), { recursive: true });
  for (const name of await readdir(sharedDir)) {
    if (name.endsWith('.js')) await cp(join(sharedDir, name), join(dist, 'public', name));
  }
  await cp(join(root, 'test', 'fixtures'), join(dist, 'test', 'fixtures'), { recursive: true });
  await chmod(join(dist, 'bin', 'nullbrand.js'), 0o755);
} else {
  console.error('usage: node scripts/copy-assets.mjs <clean|copy>');
  process.exit(2);
}
