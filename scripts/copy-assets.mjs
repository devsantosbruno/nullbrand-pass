// Build helper, plain Node (no dependencies).
//   node scripts/copy-assets.mjs clean   removes dist/ entirely (run BEFORE tsc -b, so nothing stale survives)
//   node scripts/copy-assets.mjs copy    copies everything tsc does not emit into dist/ (run AFTER tsc -b)
// Layout produced (the compiled code resolves '../package.json', '../locales/' and '../public/' relative to dist/src/):
//   dist/package.json            <- package.json (always overwritten, so the version can never be stale)
//   dist/locales/                <- locales/
//   dist/public/                 <- static/ (index.html, styles.css, favicon.svg) + the shared modules the browser imports
//   dist/test/fixtures/          <- test/fixtures/ (the compiled tests read them relative to their own file)
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
  // The browser imports './i18n.js' (and whatever it imports at runtime) next to app.js: copy every compiled shared module, flat.
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
