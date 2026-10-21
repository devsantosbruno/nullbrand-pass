// Runs the built app in development. On macOS it uses the renamed copy of Electron from brand-dev.mjs so the Dock shows the app's name.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../', import.meta.url));
let binary = createRequire(import.meta.url)('electron');
if (process.platform === 'darwin') {
  execFileSync('node', [join(here, 'scripts', 'brand-dev.mjs')], { stdio: 'inherit' });
  binary = join(here, 'dist', 'dev', 'nullbrand pass.app', 'Contents', 'MacOS', 'nullbrand pass');
}
const child = spawn(binary, [join(here, 'dist', 'app')], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
