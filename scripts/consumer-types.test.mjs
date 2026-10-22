// Consumer test for the published type declarations: packs the project, installs the tarball in an empty temp project and compiles a
// TypeScript file that imports every public entry point with `strict` and NodeNext resolution. No @types/node is installed there, so a
// declaration that leaks a Node type fails here. Needs `npm run build` first (npm test runs after it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

// Runs npm without a shell where possible: through the npm that started this process, else through the platform launcher.
function npm(args, cwd) {
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  const cli = process.env['npm_execpath'];
  if (cli && /npm-cli\.c?js$/.test(cli)) return execFileSync(process.execPath, [cli, ...args], options);
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { ...options, shell: process.platform === 'win32' });
}

const consumer = `import { Vault, FORMAT, VERSION, normalizeItem, defaultVaultPath, type VaultHeader, type VaultFile } from 'nullbrand-pass';
import { generatePassword, entropyBits, DEFAULT_OPTIONS, type GeneratorOptions } from 'nullbrand-pass/generator';
import { parseImport, planImport, exportPlain, tooLarge, MAX_IMPORT_BYTES, type ImportOptions, type ImportPlan, type ExportResult } from 'nullbrand-pass/formats';

const options: GeneratorOptions = DEFAULT_OPTIONS;
const password: string = generatePassword(options);
const bits: number = entropyBits(options);
const path: string = defaultVaultPath();
const item = normalizeItem({ name: 'example' });
const header: VaultHeader | undefined = undefined as VaultHeader | undefined;
const file: VaultFile | undefined = undefined as VaultFile | undefined;
const importOptions: ImportOptions | undefined = undefined as ImportOptions | undefined;
const plan: ImportPlan | undefined = undefined as ImportPlan | undefined;
const result: ExportResult | undefined = undefined as ExportResult | undefined;
const vault: typeof Vault = Vault;
const limit: number = MAX_IMPORT_BYTES;

// The declarations must be real types, not an implicit any: this call has to be rejected.
// @ts-expect-error normalizeItem takes an object, not a number
normalizeItem(1);

export { FORMAT, VERSION, parseImport, planImport, exportPlain, tooLarge, password, bits, path, item, header, file, importOptions, plan, result, vault, limit };
`;

const tsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    types: [],
  },
  files: ['consumer.ts'],
};

test('the packed tarball is fully typed for a strict consumer without @types/node', { timeout: 180_000 }, () => {
  assert.ok(existsSync(join(root, 'dist', 'src', 'vault.d.ts')), 'dist/ is missing: run `npm run build` first');
  assert.ok(existsSync(tsc), 'typescript is not installed: run `npm ci`');

  const work = mkdtempSync(join(tmpdir(), 'nullbrand-consumer-'));
  try {
    // --ignore-scripts: `prepack` runs the whole verify (including this test), which would recurse.
    npm(['pack', '--ignore-scripts', '--pack-destination', work], root);
    const tarballs = readdirSync(work).filter((name) => name.endsWith('.tgz'));
    assert.equal(tarballs.length, 1, 'npm pack should produce exactly one tarball');

    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
    npm(['install', join(work, tarballs[0]), '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], work);
    assert.ok(!existsSync(join(work, 'node_modules', '@types', 'node')), 'the consumer must not have @types/node');

    writeFileSync(join(work, 'consumer.ts'), consumer);
    writeFileSync(join(work, 'tsconfig.json'), JSON.stringify(tsconfig));
    try {
      execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      assert.fail(`the consumer does not compile:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
