import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Vault, vaultExists, destroyVault, defaultVaultPath, readBackupItems, hardenPermissions, verifyMasterPassword, writePrivateFile } from './vault.js';
import type { VaultItem } from './shared/vault-types.js';
import { hasErrorCode, isObjectLike } from './shared/guards.js';
import type { TranslateParams, Translator } from './shared/i18n.js';
import { generatePassword, entropyBits } from './generator.js';
import { parseImport, placeImport, exportPlain, tooLarge, MAX_IMPORT_BYTES } from './formats/index.js';
import { startServer, type RunningServer } from './server.js';
import { ask, confirm, closePrompt } from './prompt.js';
import { openBrowser, isHeadless } from './system.js';
import { createClipboard, installExitHooks, ClipboardError, DEFAULT_TTL_MS, type CopyResult } from './clipboard.js';
import { translator, resolveForProcess, errText } from './i18n.js';
import { defaultHome } from './vault.js';
import { coded } from './errors.js';

const pkg: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = isObjectLike(pkg) && typeof pkg['version'] === 'string' ? pkg['version'] : undefined;
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  ok: (s: string) => (color ? `\x1b[38;5;108m${s}\x1b[0m` : s),
  dim: (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s),
  warn: (s: string) => (color ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s),
};
const logo = () => `${c.dim('$')} ${c.bold('nullbrand-pass')} ${c.dim('v' + version)}`;

// Language of this process; set by main() once the language sources are resolved.
let t: Translator = translator('en');

const COL = 38;
const row = (left: string, key: string, params?: TranslateParams): string => `  ${left.padEnd(COL)}${t(key, params)}`;
function help(): string {
  return `
${logo()}
${t('help.tagline')}

${c.bold(t('help.usage'))}
${row('nullbrand-pass', 'help.usageUi')}
  nullbrand-pass <command> [options]

${c.bold(t('help.commands'))}
${row('ui', 'help.cmd.ui')}
${row('init', 'help.cmd.init')}
${row('list [query]', 'help.cmd.list')}
${row('get <query> [--show] [--clear <s>]', 'help.cmd.get', { seconds: DEFAULT_TTL_MS / 1000 })}
${row('add', 'help.cmd.add')}
${row('rm <query>', 'help.cmd.rm')}
${row('generate [-l 20] [--no-symbols]', 'help.cmd.generate')}
           [--no-digits] [--no-upper] [--no-lower] [--avoid-ambiguous]
${row('import <file.json>', 'help.cmd.import')}
${row('  [--folder <name>]', 'help.opt.folder')}
${row('  [--ignore-folders]', 'help.opt.ignoreFolders')}
${row('import backup <file.json>', 'help.cmd.importBackup')}
${row('export <file.json>', 'help.cmd.export')}
${row('export <file.json> --unencrypted', 'help.cmd.exportPlain')}
${row('  [--i-understand]', 'help.opt.iUnderstand')}
${row('passwd', 'help.cmd.passwd')}
${row('destroy [--yes]', 'help.cmd.destroy')}
${row('where', 'help.cmd.where')}

${c.bold(t('help.webOptions'))}
${row('--port <n>', 'help.opt.port')}
${row('--idle <min>', 'help.opt.idle', { minutes: 15 })}
${row('--no-open', 'help.opt.noOpen')}
${row('--print-url', 'help.opt.printUrl')}
${row('--clear <s>', 'help.opt.clear', { seconds: DEFAULT_TTL_MS / 1000 })}

${c.bold(t('help.generalOptions'))}
${row('--vault <path>', 'help.opt.vault')}
${row('--lang <en|pt>', 'help.opt.lang')}
${row('-h, --help', 'help.opt.help')}
${row('-v, --version', 'help.opt.version')}

${t('help.vaultAt', { path: c.dim(defaultVaultPath()) })}
${t('help.vaultChange')}
${t('help.langAt', { path: c.dim(join(defaultHome(), 'config.json')) })}
`;
}

// Parsed flags: a string, or a boolean (--x = true, --no-x = false). A value flag left without a value stays undefined.
interface Flags {
  [flag: string]: string | boolean | undefined;
  // Take a value (--port 3000, --port=3000); `false` for --no-port.
  port?: string | false | undefined;
  idle?: string | false | undefined;
  vault?: string | false | undefined;
  length?: string | false | undefined;
  clear?: string | false | undefined;
  lang?: string | false | undefined;
  // Switches: true, false (--no-x) or a string (--x=value).
  help?: string | boolean | undefined;
  version?: string | boolean | undefined;
  show?: string | boolean | undefined;
  yes?: string | boolean | undefined;
  open?: string | boolean | undefined;
  upper?: string | boolean | undefined;
  lower?: string | boolean | undefined;
  digits?: string | boolean | undefined;
  symbols?: string | boolean | undefined;
}

const VALUE_FLAGS: readonly string[] = ['port', 'idle', 'vault', 'length', 'clear', 'lang', 'folder'];
const SWITCH_FLAGS: readonly string[] = ['help', 'version', 'show', 'yes', 'open', 'upper', 'lower', 'digits', 'symbols', 'avoid-ambiguous', 'print-url', 'ignore-folders', 'unencrypted', 'i-understand'];

// `missing` lists value flags with no value (last argument, or followed by another `--flag`); `unknown` lists unrecognized flags.
function parseArgs(argv: readonly string[]): { positional: string[]; flags: Flags; missing: string[]; unknown: string[] } {
  const positional: string[] = [];
  const flags: Flags = {};
  const missing: string[] = [];
  const unknown: string[] = [];
  const takeValue = (key: string, shown: string, i: number): number => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      missing.push(shown);
      return i;
    }
    flags[key] = next;
    return i + 1;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--no-')) {
      const k = a.slice(5);
      flags[k] = false;
      if (!VALUE_FLAGS.includes(k) && !SWITCH_FLAGS.includes(k)) unknown.push(a);
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      if (!VALUE_FLAGS.includes(k) && !SWITCH_FLAGS.includes(k)) unknown.push(a);
      if (eq >= 0) flags[k] = a.slice(eq + 1);
      else if (VALUE_FLAGS.includes(k)) i = takeValue(k, a, i);
      else flags[k] = true;
    } else if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else if (a === '-l') i = takeValue('length', a, i);
    else positional.push(a);
  }
  return { positional, flags, missing, unknown };
}

class CliError extends Error {}

// y/N prompt in the active language; the English answers are always accepted.
const confirmT = (question: string): Promise<boolean> => confirm(question, { suffix: t('cli.yesNo'), yes: t('cli.yesWords').split(',') });

// Reads --clear <seconds> into milliseconds; --no-clear means 0 (never clear).
function clearMs(flags: Flags): number {
  if (flags.clear === undefined) return DEFAULT_TTL_MS;
  if (flags.clear === false) return 0;
  const n = Number(flags.clear);
  if (!Number.isFinite(n) || n < 0) throw new CliError(t('cli.clearInvalid'));
  return Math.round(n * 1000);
}

/** Reports on stderr, without secret material, that an old vault was upgraded or that the upgrade failed. */
export function reportMigration(vault: Vault, log: (message: string) => void = console.error): void {
  if (vault.migration) {
    const { from, backup } = vault.migration;
    log(c.ok('✓') + ' ' + t('cli.migrated', { version: vault.header.version, n: Math.log2(vault.header.kdf.N), fromVersion: from.version, fromN: Math.log2(from.N) }));
    log(c.dim('  ' + t('cli.migratedBackup', { path: backup })));
  } else if (vault.migrationError) {
    log(c.red('! ' + t('cli.migrateFailed', { reason: vault.migrationError })));
  }
}

// Prompts for the master password, with three attempts.
async function unlockInteractive(vaultPath: string): Promise<Vault> {
  if (!vaultExists(vaultPath)) {
    throw new CliError(t('cli.noVault', { path: vaultPath }));
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const pw = await ask(t('cli.prompt.master') + ' ', { hidden: true });
    try {
      const vault = await Vault.unlock(pw, vaultPath);
      reportMigration(vault);
      return vault;
    } catch (err) {
      if (!hasErrorCode(err, 'WRONG_PASSWORD')) throw err;
      console.error(c.red(errText(t, err)));
    }
  }
  throw new CliError(t('cli.tooManyAttempts'));
}

async function chooseItem(vault: Vault, query: string): Promise<VaultItem> {
  if (!query) throw new CliError(t('cli.itemNameRequired'));
  const matches = vault.find(query);
  if (matches.length === 0) throw new CliError(t('cli.noMatch', { query }));
  const only = matches[0];
  if (matches.length === 1 && only) return only;
  const exact = matches.filter((m) => m.name.toLowerCase() === query.toLowerCase());
  const exactOnly = exact[0];
  if (exact.length === 1 && exactOnly) return exactOnly;
  matches.slice(0, 20).forEach((m, i) => console.log(`  ${c.bold(String(i + 1).padStart(2))}  ${m.name} ${c.dim(m.username || '')}`));
  const n = Number.parseInt(await ask(t('cli.pickItem', { max: Math.min(20, matches.length) }) + ' '), 10);
  const item = matches[n - 1];
  if (!item) throw new CliError(t('cli.invalidSelection'));
  return item;
}

function printItems(items: readonly VaultItem[]): void {
  if (items.length === 0) return console.log(c.dim('  ' + t('cli.noItems')));
  const w = Math.min(36, Math.max(...items.map((i) => i.name.length)));
  for (const i of items) {
    const name = i.name.length > w ? i.name.slice(0, w - 1) + '…' : i.name.padEnd(w);
    const detail = i.type === 'note' ? c.dim(t('cli.kind.note')) : i.type === 'ssh' ? c.dim(t('cli.kind.ssh') + (i.sshHost ? ' · ' + (i.sshUser ? i.sshUser + '@' : '') + i.sshHost : '')) : i.type === 'identity' ? c.dim(t('cli.kind.identity') + (i.fullName ? ' · ' + i.fullName : '')) : i.type === 'card' ? c.dim(t('cli.kind.card') + (i.cardNumber ? ' •••• ' + i.cardNumber.replace(/\D/g, '').slice(-4) : '')) : `${i.username}${i.uris[0] ? c.dim('  ' + i.uris[0]) : ''}`;
    console.log(`  ${i.favorite ? c.bold('★') : ' '} ${name}  ${detail}`);
  }
}

function importSummary(added: number, skipped: number, ignored: number): string {
  return [t('import.added', { count: added }), skipped && t('import.skipped', { count: skipped }), ignored && t('import.ignored', { count: ignored })].filter(Boolean).join(', ');
}

function importOptions(flags: Flags): { folder?: string; ignoreFolders: boolean } {
  const folder = flags['folder'];
  return { ...(typeof folder === 'string' && { folder }), ignoreFolders: flags['ignore-folders'] === true };
}

async function importBackup(path: string | undefined, vaultPath: string): Promise<void> {
  const file = path && resolve(path);
  if (!file) throw new CliError(t('cli.import.usage'));
  if (!existsSync(file)) throw new CliError(t('cli.import.notFound', { path: file }));
  const pw = await ask(t('cli.import.backupPassword') + ' ', { hidden: true });
  let items: readonly Readonly<Record<string, unknown>>[];
  try {
    items = await readBackupItems(file, pw);
  } catch (err) {
    if (hasErrorCode(err, 'WRONG_PASSWORD')) throw new CliError(t('err.http.backupWrongPassword'));
    throw err;
  }
  console.log(c.dim(t('cli.import.found', { count: items.length })));
  const vault = await unlockInteractive(vaultPath);
  const r = await vault.merge(items);
  console.log(`${c.ok('✓')} ${importSummary(r.added, r.skipped, 0)}.`);
}

// An unencrypted export asks for the master password again (the key in memory does not prove who is at the keyboard)
// and for an explicit acknowledgement: --i-understand or a y/N answer.
async function confirmPlainExport(vaultPath: string, acknowledged: boolean): Promise<void> {
  console.error(c.red('! ') + t('export.warning'));
  if (!acknowledged && !(await confirmT(t('cli.export.confirmPlain')))) throw new CliError(t('cli.cancelled'));
  const pw = await ask(t('cli.prompt.master') + ' ', { hidden: true });
  try {
    await verifyMasterPassword(pw, vaultPath);
  } catch (err) {
    if (hasErrorCode(err, 'WRONG_PASSWORD')) throw new CliError(errText(t, err));
    throw err;
  }
}

interface CommandContext {
  positional: string[];
  flags: Flags;
  vaultPath: string;
}
type Command = (context: CommandContext) => Promise<void>;

const commands: Record<string, Command | undefined> = {
  async ui({ flags, vaultPath }) {
    const idleMinutes = flags.idle !== undefined ? Number(flags.idle) : 15;
    const port = flags.port ? Number(flags.port) : 0;
    let srv: RunningServer;
    try {
      srv = await startServer({ vaultPath, port, idleMinutes, clipboardTtlMs: clearMs(flags), langFlag: flags.lang, onShutdown: () => process.exit(0) });
    } catch (err) {
      if (hasErrorCode(err, 'EADDRINUSE')) throw new CliError(t('cli.portInUse', { port }));
      throw err;
    }
    console.log(`\n${logo()}\n`);
    console.log(`  ${t('cli.ui.vault')} ${c.dim(vaultPath)}${vaultExists(vaultPath) ? '' : c.dim(' ' + t('cli.ui.willCreate'))}`);
    console.log(c.dim('  ' + t('cli.ui.listening') + '\n'));
    // The token stays out of the terminal unless the browser does not open or --print-url is given.
    const printUrl = () => {
      console.log(`  ${t('cli.ui.open')} ${c.bold(srv.url)}`);
      console.log(c.dim('  ' + t('cli.ui.linkNote') + '\n'));
    };
    const shouldOpen = flags.open !== false && !isHeadless();
    const opened = shouldOpen && (await openBrowser(srv.url));
    if (shouldOpen && !opened) console.log(c.dim('  ' + t('cli.ui.browserFailed')));
    if (flags['print-url'] || !opened) printUrl();
    const stop = async () => {
      console.log(c.dim('\n  ' + t('cli.ui.shuttingDown')));
      await srv.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    // Never settles: keeps the process alive.
    return new Promise<void>(() => {});
  },

  async init({ vaultPath }) {
    if (vaultExists(vaultPath)) throw new CliError(t('cli.init.exists', { path: vaultPath }));
    console.log(`${logo()}\n`);
    console.log(t('cli.init.intro') + '\n');
    const p1 = await ask(t('cli.prompt.newMaster') + ' ', { hidden: true });
    const p2 = await ask(t('cli.prompt.confirm') + ' ', { hidden: true });
    if (p1 !== p2) throw new CliError(t('cli.mismatch'));
    await Vault.create(p1, vaultPath);
    console.log(`\n${c.ok('✓')} ${t('cli.init.created', { path: vaultPath })}`);
  },

  async list({ positional, vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const items = positional[1] ? vault.find(positional[1]) : vault.list();
    console.log(c.dim(`\n  ${t('cli.list.count', { count: items.length })}\n`));
    printItems(items);
  },

  async get({ positional, flags, vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const item = await chooseItem(vault, positional.slice(1).join(' '));
    console.log(`\n  ${c.bold(item.name)}${item.folder ? c.dim('  [' + item.folder + ']') : ''}`);
    const labels = ['username', 'site', 'password'].map((k) => t(`cli.field.${k}`));
    const w = Math.max(...labels.map((l) => l.length)) + 2;
    const field = (i: number, v: string): void => console.log(`  ${(labels[i] + ':').padEnd(w)}${v}`);
    if (item.username) field(0, item.username);
    item.uris.forEach((u) => field(1, u));
    if (item.type === 'note' || flags.show) {
      if (item.password) field(2, item.password);
      if (item.notes) console.log(`\n${item.notes}`);
      return;
    }
    if (!item.password) return console.log(c.dim('  ' + t('cli.get.noPassword')));
    const ttlMs = clearMs(flags);
    const clip = createClipboard({ ttlMs });
    let copied: CopyResult;
    try {
      copied = await clip.copy(item.password);
    } catch (err) {
      if (err instanceof ClipboardError) throw new CliError(`${errText(t, err)} ${t('cli.get.useShow')}`);
      throw err;
    }
    // The vault key is not needed while waiting. The password string itself stays until exit, since JS strings are immutable.
    vault.key?.fill(0);
    if (!copied.concealed) console.log(`  ${c.warn('!')} ${t('clipboard.notConcealed')}`);
    const expiresAt = copied.expiresAt;
    if (!expiresAt) return console.log(`  ${c.ok('✓')} ${t('cli.get.copiedNoClear')}`);

    // Stays alive until cleared: the timer lives in this process, and Ctrl+C or closing the terminal clears at once.
    // A detached child would outlive the terminal but could not report errors or a countdown, and would need the hash passed to it.
    const uninstall = installExitHooks(clip, { exit: () => { process.stdout.write('\n'); process.exit(130); } });
    const paint = () => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (process.stdout.isTTY) process.stdout.write(`\r  ${c.ok('✓')} ${t('clipboard.copied', { s: left })} ${c.dim(t('cli.get.ctrlC'))}\x1b[K`);
    };
    if (!process.stdout.isTTY) console.log(`  ${c.ok('✓')} ${t('clipboard.copied', { s: Math.round(ttlMs / 1000) })} ${t('cli.get.keepOpen')}`);
    paint();
    const tick = setInterval(paint, 1000);
    const result = await copied.done;
    clearInterval(tick);
    uninstall();
    const messages: Record<string, string> = {
      cleared: `${c.ok('✓')} ${t('clipboard.cleared')}`,
      changed: t('cli.get.changed'),
      unverified: c.red(t('cli.get.unverified')),
      failed: c.red(t('cli.get.clearFailed')),
      replaced: t('cli.get.replaced'),
    };
    const msg = messages[result] || result;
    console.log(process.stdout.isTTY ? `\r  ${msg}\x1b[K` : `  ${msg}`);
  },

  async add({ vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const name = (await ask(t('cli.add.name') + ' ')).trim();
    if (!name) throw new CliError(t('cli.add.nameRequired'));
    const username = (await ask(t('cli.add.username') + ' ')).trim();
    let password = await ask(t('cli.add.password') + ' ', { hidden: true });
    if (!password) {
      password = generatePassword();
      console.log(c.dim('  ' + t('cli.add.generated', { count: 20 })));
    }
    const uri = (await ask(t('cli.add.site') + ' ')).trim();
    const folder = (await ask(t('cli.add.folder') + ' ')).trim();
    const item = await vault.add({ type: 'login', name, username, password, uris: uri ? [uri] : [], folder });
    console.log(`${c.ok('✓')} ${t('cli.add.saved', { name: item.name })}`);
  },

  async rm({ positional, vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const item = await chooseItem(vault, positional.slice(1).join(' '));
    if (!(await confirmT(t('cli.rm.confirm', { name: item.name, who: item.username ? ` (${item.username})` : '' })))) return console.log(t('cli.cancelled'));
    await vault.remove(item.id);
    console.log(`${c.ok('✓')} ${t('cli.rm.deleted')}`);
  },

  async generate({ flags }) {
    const opts = {
      length: flags.length ?? 20,
      upper: flags.upper !== false,
      lower: flags.lower !== false,
      digits: flags.digits !== false,
      symbols: flags.symbols !== false,
      avoidAmbiguous: Boolean(flags['avoid-ambiguous']),
    };
    const pw = generatePassword(opts);
    console.log(pw);
    if (process.stdout.isTTY) console.error(c.dim(t('cli.generate.entropy', { bits: entropyBits({ ...opts, length: pw.length }) })));
  },

  async import({ positional, flags, vaultPath }) {
    if (positional[1] === 'backup') return importBackup(positional[2], vaultPath);
    const file = positional[1] && resolve(positional[1]);
    if (!file) throw new CliError(t('cli.import.usage'));
    if (!existsSync(file)) throw new CliError(t('cli.import.notFound', { path: file }));
    if ((await stat(file)).size > MAX_IMPORT_BYTES) throw tooLarge();

    const options = importOptions(flags);
    const plan = parseImport(await readFile(file, 'utf8'));
    console.log(c.dim(t('cli.import.found', { count: plan.items.length })));

    const vault = await unlockInteractive(vaultPath);
    const placed = placeImport(plan, { ...options, existingFolders: vault.listFolders() });
    const r = await vault.merge(placed.items);
    for (const w of placed.warnings) console.log(c.dim('  ! ' + t(w.key, w.params)));
    console.log(`${c.ok('✓')} ${importSummary(r.added, r.skipped, placed.ignored)}.`);
    console.log(c.dim('  ' + t('import.deleteExport')));
  },

  async export({ positional, flags, vaultPath }) {
    const plain = flags['unencrypted'] === true;
    const dest = positional[1] ? resolve(positional[1]) : resolve(plain ? exportPlain([], []).filename : `nullbrand-backup-${new Date().toISOString().slice(0, 10)}.json`);
    if (existsSync(dest) && !(await confirmT(t('cli.export.overwrite', { path: dest })))) return console.log(t('cli.cancelled'));
    const vault = await unlockInteractive(vaultPath);
    if (!plain) {
      await vault.exportBackup(dest);
      return console.log(`${c.ok('✓')} ${t('cli.export.saved', { path: dest })}`);
    }
    await confirmPlainExport(vaultPath, flags['i-understand'] === true);
    const { text, warnings } = exportPlain(vault.items, vault.listFolders());
    await writePrivateFile(dest, text);
    for (const w of warnings) console.log(c.dim('  ! ' + t(w.key, w.params)));
    console.log(`${c.ok('✓')} ${t('cli.export.savedPlain', { path: dest })}`);
    console.log(c.red('! ') + t('export.deleteAfter'));
  },

  async passwd({ vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const p1 = await ask(t('cli.prompt.newMaster') + ' ', { hidden: true });
    const p2 = await ask(t('cli.prompt.confirm') + ' ', { hidden: true });
    if (p1 !== p2) throw new CliError(t('cli.mismatch'));
    await vault.changePassword(p1);
    console.log(`${c.ok('✓')} ${t('cli.passwd.changed')}`);
  },

  async destroy({ flags, vaultPath }) {
    if (!vaultExists(vaultPath)) throw new CliError(t('cli.destroy.noVault', { path: vaultPath }));
    if (!flags.yes) {
      console.log(t('cli.destroy.warn', { path: vaultPath }));
      console.log(t('cli.destroy.backupsSafe'));
      const word = t('cli.destroy.word');
      const a = (await ask(t('cli.destroy.type', { word }) + ' ')).trim().toLowerCase();
      if (a !== word && a !== 'delete') return console.log(t('cli.cancelled'));
    }
    await destroyVault(vaultPath);
    console.log(`${c.ok('✓')} ${t('cli.destroy.done')}`);
  },

  async where({ vaultPath }) {
    console.log(vaultPath + (vaultExists(vaultPath) ? '' : c.dim('  ' + t('cli.where.missing'))));
  },
};
commands['start'] = commands['ui'];
commands['ls'] = commands['list'];
commands['gen'] = commands['generate'];

/** Reports a stdout write error other than EPIPE, in the language main() resolved. */
export function reportOutputError(err: unknown): void {
  process.stderr.write(c.red(`✗ ${errText(t, err)}`) + '\n');
}

/** Runs the CLI: parses `argv`, hardens permissions and dispatches the command. Failures set `process.exitCode`. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { positional, flags, missing, unknown } = parseArgs(argv);
  const resolved = resolveForProcess({ flag: flags.lang === undefined ? undefined : String(flags.lang), home: defaultHome() });
  t = translator(resolved.lang);
  for (const w of resolved.warnings) console.error(c.red('! ') + t('lang.invalid', { source: w.source === 'flag' ? '--lang' : 'NULLBRAND_LANG', value: w.value }));
  for (const flag of unknown) console.error(c.red('! ') + t('cli.unknownFlag', { flag }));
  if (flags.version) return console.log(version);
  if (flags.help || positional[0] === 'help') return console.log(help());
  const [absent] = missing;
  if (absent !== undefined) {
    console.error(c.red(`✗ ${errText(t, coded('err.cli.missingValue', `${absent} expects a value.`, { flag: absent }))}`));
    process.exitCode = 1;
    return;
  }
  const name = positional[0] || 'ui';
  const cmd = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!cmd) {
    console.error(c.red(t('cli.unknownCommand', { name })));
    console.log(help());
    process.exitCode = 1;
    return;
  }
  const vaultPath = flags.vault ? resolve(flags.vault) : defaultVaultPath();
  try {
    for (const m of await hardenPermissions(vaultPath, { detailed: true })) console.error(c.red('! ') + t(m.key, m.params));
    await cmd({ positional, flags, vaultPath });
  } catch (err) {
    console.error(c.red(`✗ ${errText(t, err)}`));
    process.exitCode = 1;
  } finally {
    if (name !== 'ui' && name !== 'start') closePrompt();
  }
}
