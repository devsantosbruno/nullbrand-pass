// Prepares dist/app, the folder that is run in development and packaged for release. Plain Node.
//   dist/app/core/         a copy of the compiled core: ../dist/{src,public,locales,package.json}, no tests, CLI or web sources
//   dist/app/package.json  the app manifest, taking the metadata from ../package.json
// tsc then writes main.js, security.js and preload.cjs into dist/app, next to core/. Run `npm run build` in the repository root first
// (the `build` script of this package does).
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';

const here = fileURLToPath(new URL('../', import.meta.url));
const coreDist = fileURLToPath(new URL('../../dist/', import.meta.url));
const appDir = join(here, 'dist', 'app');

try {
  await stat(join(coreDist, 'src', 'server.js'));
} catch {
  throw new Error('stage: ../dist/src/server.js not found. Run "npm run build" in the repository root first.');
}

const rootPkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const core = join(appDir, 'core');

await rm(appDir, { recursive: true, force: true });
await mkdir(core, { recursive: true });

// Only what the server needs at run time. The type declarations stay: the type checker reads them (see tsconfig.json), and the
// packager leaves them out (builder.yml).
const webSources = join(coreDist, 'src', 'web') + sep;
const keep = (source) => !source.startsWith(webSources);
for (const name of ['src', 'public', 'locales']) await cp(join(coreDist, name), join(core, name), { recursive: true, filter: keep });
await cp(join(coreDist, 'package.json'), join(core, 'package.json'));

const manifest = {
  name: 'nullbrand',
  productName: 'nullbrand pass',
  version: rootPkg.version,
  description: rootPkg.description,
  author: rootPkg.author,
  homepage: rootPkg.homepage,
  license: rootPkg.license,
  type: 'module',
  main: 'main.js',
};
await writeFile(join(appDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`stage: ${appDir}`);
