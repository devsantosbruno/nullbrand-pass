// Clipboard with automatic clearing.
//
// Two layers:
//  - per-platform backends (native subprocesses, no dependencies);
//  - createClipboard(): the timer logic and the "only clear if it is still the password" rule,
//    which takes the backend as a parameter and is therefore testable without touching the real clipboard.
//
// Security rules: the text goes to the subprocess ALWAYS through stdin (arguments show up
// in ps and /proc), with shell: false. The manager only keeps the SHA-256 of what it copied.
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { coded } from './errors.js';
import { errorMessage } from './shared/guards.js';
import type { TranslateParams } from './shared/i18n.js';
import type { SpawnFn } from './system.js';

export const DEFAULT_TTL_MS = 30_000;

export class ClipboardError extends Error {
  declare readonly key: string;
  declare readonly params: TranslateParams;
  constructor(message: string, key: string, params: TranslateParams = {}) {
    super(message);
    this.name = 'ClipboardError';
    this.key = key;
    this.params = params;
  }
}

const sha256 = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();
const sameHash = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

// ---------- subprocesses ----------

export interface RunOptions {
  input?: string | Uint8Array;
  capture?: boolean;
  spawnFn?: SpawnFn;
}
// How a backend runs a command (injectable for testing).
export type Exec = (cmd: string, args: readonly string[], options?: RunOptions) => Promise<string>;

// Runs a command without a shell. `input` (string or Buffer) goes through stdin; nothing goes in args.
// For writes we don't capture stdout/stderr: xclip and wl-copy stay in the background
// holding the selection, and an open pipe would keep 'close' from ever arriving.
export function run(cmd: string, args: readonly string[], { input, capture = false, spawnFn = spawn }: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<SpawnFn>;
    try {
      child = spawnFn(cmd, args, { shell: false, windowsHide: true, stdio: ['pipe', capture ? 'pipe' : 'ignore', 'ignore'] });
    } catch (err) {
      return reject(new ClipboardError(`Could not run ${cmd}: ${errorMessage(err)}`, 'err.clipboard.run', { cmd, reason: errorMessage(err) }));
    }
    const out: Buffer[] = [];
    child.stdout?.on('data', (d) => out.push(d));
    child.once('error', (err) => reject(new ClipboardError(`Could not run ${cmd}: ${err.message}`, 'err.clipboard.run', { cmd, reason: err.message })));
    child.once(capture ? 'close' : 'exit', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new ClipboardError(`${cmd} exited with code ${code}.`, 'err.clipboard.exit', { cmd, code }));
    });
    // Without a stdin pipe the text can never reach the tool: that is a failure to REPORT (the caller sees the rejection), never a
    // silent no-op. It used to be a TypeError thrown here, which rejected this same promise. The child is stopped so it is not left
    // waiting for input that will never come.
    const stdin = child.stdin;
    if (!stdin) {
      child.kill();
      return reject(new ClipboardError(`Could not run ${cmd}: no stdin pipe.`, 'err.clipboard.run', { cmd, reason: 'no stdin pipe' }));
    }
    stdin.on('error', () => {}); // EPIPE if the process exits before reading everything; the exit code already tells
    stdin.end(input ?? '');
  });
}

async function onPath(cmd: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    try {
      await access(join(dir, cmd), constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

// ---------- backends ----------
// Interface: { name, write(text, { sensitive }), read() → string, clear() }
export interface Backend {
  name: string;
  // Set by write(): true when a sensitive write could not be marked as concealed and fell back to a plain copy.
  degraded?: boolean;
  write(text: string, options?: { sensitive?: boolean }): Promise<string>;
  read(): Promise<string>;
  clear(): Promise<string>;
}

// macOS: pbcopy/pbpaste. To mark the content as sensitive we use osascript (JXA), which ships with
// the system: it reads the password from stdin and declares the org.nspasteboard.ConcealedType type, which
// clipboard history managers (Maccy, Alfred, Raycast…) respect. If it fails, falls back to pbcopy.
const JXA_CONCEALED = `
ObjC.import("AppKit");
const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
const str = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
const pb = $.NSPasteboard.generalPasteboard;
pb.clearContents;
pb.declareTypesOwner($(["public.utf8-plain-text", "org.nspasteboard.ConcealedType"]), $());
pb.setStringForType(str, "public.utf8-plain-text");
pb.setStringForType($(""), "org.nspasteboard.ConcealedType");
`;

export function macBackend(exec: Exec = run): Backend {
  const backend: Backend = {
    name: 'macOS (pbcopy)',
    degraded: false,
    async write(text, { sensitive = false } = {}) {
      backend.degraded = false;
      if (sensitive) {
        try {
          return await exec('osascript', ['-l', 'JavaScript', '-e', JXA_CONCEALED], { input: text });
        } catch {
          backend.degraded = true; // copied anyway, but clipboard history managers will see it: copy() reports it
        }
      }
      return exec('pbcopy', [], { input: text });
    },
    read: () => exec('pbpaste', [], { capture: true }),
    clear: () => exec('pbcopy', [], { input: '' }),
  };
  return backend;
}

// Windows: clip.exe reads stdin in the OEM code page, which mangles accented characters. It recognizes
// UTF-16LE when the text starts with a BOM, so we send it that way. Reading and clearing go through
// PowerShell (fixed commands, no user data on the command line).
// NOTE: we don't implement the ExcludeClipboardContentFromMonitorProcessing format. It would be possible
// with Add-Type + P/Invoke (RegisterClipboardFormat + SetClipboardData), without a native module, but there
// is no way to test it here; it stays a future improvement instead of blind code.
const PS_READ = '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; [Console]::Out.Write((Get-Clipboard -Raw))';
const PS_CLEAR = 'Set-Clipboard -Value $null';
const PS_ARGS = (command: string): string[] => ['-NoProfile', '-NonInteractive', '-Command', command];

export function windowsBackend(exec: Exec = run, shell: string = 'powershell.exe'): Backend {
  return {
    name: 'Windows (clip.exe)',
    write: (text) => exec('clip.exe', [], { input: Buffer.from('﻿' + text, 'utf16le') }),
    read: () => exec(shell, PS_ARGS(PS_READ), { capture: true }),
    clear: () => exec(shell, PS_ARGS(PS_CLEAR)),
  };
}

const WAYLAND_HINT = 'Install wl-clipboard (e.g. sudo apt install wl-clipboard).';
const X11_HINT = 'Install xclip or xsel (e.g. sudo apt install xclip).';

export function waylandBackend(exec: Exec = run): Backend {
  return {
    name: 'Wayland (wl-copy)',
    write: (text) => exec('wl-copy', [], { input: text }),
    read: () => exec('wl-paste', ['--no-newline'], { capture: true }),
    clear: () => exec('wl-copy', ['--clear']),
  };
}

export function xclipBackend(exec: Exec = run): Backend {
  return {
    name: 'X11 (xclip)',
    write: (text) => exec('xclip', ['-selection', 'clipboard'], { input: text }),
    read: () => exec('xclip', ['-selection', 'clipboard', '-o'], { capture: true }),
    clear: () => exec('xclip', ['-selection', 'clipboard'], { input: '' }),
  };
}

export function xselBackend(exec: Exec = run): Backend {
  return {
    name: 'X11 (xsel)',
    write: (text) => exec('xsel', ['--clipboard', '--input'], { input: text }),
    read: () => exec('xsel', ['--clipboard', '--output'], { capture: true }),
    clear: () => exec('xsel', ['--clipboard', '--clear']),
  };
}

export interface DetectOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  has?: (cmd: string) => Promise<boolean>;
}

// Picks the platform backend. `has` and `env` are injectable for testing.
export async function detectBackend({ platform = process.platform, env = process.env, has = (c: string) => onPath(c, env) }: DetectOptions = {}): Promise<Backend> {
  if (platform === 'darwin') return macBackend();
  if (platform === 'win32') return windowsBackend();
  if (env.WAYLAND_DISPLAY && (await has('wl-copy')) && (await has('wl-paste'))) return waylandBackend();
  if (env.DISPLAY) {
    if (await has('xclip')) return xclipBackend();
    if (await has('xsel')) return xselBackend();
  }
  if (!env.WAYLAND_DISPLAY && !env.DISPLAY) {
    throw new ClipboardError('No graphical session (WAYLAND_DISPLAY/DISPLAY empty): there is no clipboard to use.', 'err.clipboard.noSession');
  }
  throw new ClipboardError(`No clipboard tool found. ${env.WAYLAND_DISPLAY ? WAYLAND_HINT : X11_HINT}`, env.WAYLAND_DISPLAY ? 'err.clipboard.noToolWayland' : 'err.clipboard.noToolX11');
}

// ---------- copy and clear logic ----------

// Results of a copy (they resolve `done`):
//   cleared     the timer fired (or flush) and the clipboard still held the password: it was cleared
//   changed     the user copied something else afterwards: we leave it alone
//   unverified  the clipboard could not be read: we don't clear blindly
//   failed      the clipboard still held the password and clearing it failed: it stays there
//   replaced    a newer copy took this one's place
export type ClearResult = 'cleared' | 'changed' | 'unverified' | 'failed' | 'replaced';

// What the serialized copy/clear operations resolve with.
export type Settled = CopyResult | ClearResult | 'none' | void;

export interface CopyResult {
  // false when a sensitive copy could not be hidden from clipboard history managers (macOS fallback to pbcopy).
  concealed: boolean;
  ttlMs: number;
  expiresAt: number | null;
  done: Promise<ClearResult | 'disabled'>;
}
export interface Clipboard {
  copy(text: string, options?: { sensitive?: boolean; ttlMs?: number }): Promise<CopyResult>;
  flush(): Promise<ClearResult | 'none'>;
  readonly pending: boolean;
  idle(): Promise<Settled>;
}
export interface ClipboardOptions {
  backend?: Backend | (() => Backend | Promise<Backend>);
  ttlMs?: number;
}

interface PendingClear {
  hash: Buffer;
  timer: NodeJS.Timeout | undefined;
  gen: number;
  settle: (result: ClearResult) => void;
}

export function createClipboard({ backend, ttlMs = DEFAULT_TTL_MS }: ClipboardOptions = {}): Clipboard {
  let resolved: Backend | null = null; // memoized backend
  let state: PendingClear | null = null; // { hash, timer, gen, settle }
  let gen = 0;
  let queue: Promise<Settled> = Promise.resolve(); // serializes copy/clear so one doesn't step on the other

  const getBackend = async (): Promise<Backend> => {
    if (!resolved) resolved = typeof backend === 'function' ? await backend() : backend ? backend : await detectBackend();
    return resolved;
  };
  const enqueue = <T extends Settled>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  // Clears only if the current content is still what we copied. The state is dropped before
  // any await: repeated calls (signal + beforeExit, for example) don't clear twice.
  function flush(): Promise<ClearResult | 'none'> {
    return enqueue(async () => {
      const s = state;
      if (!s) return 'none';
      state = null;
      if (s.timer !== undefined) clearTimeout(s.timer);
      let result: ClearResult;
      let b: Backend | null = null;
      let current: string | null = null;
      try {
        b = await getBackend();
        current = await b.read().then((t) => t, () => null);
      } catch {
        // no backend or no way to read: nothing was verified
      }
      if (b === null || current === null) result = 'unverified';
      else if (!sameHash(sha256(current), s.hash)) result = 'changed';
      else {
        // The read proved the password is still there, so a failed clear is not "unverified".
        try {
          await b.clear();
          result = 'cleared';
        } catch {
          result = 'failed';
        }
      }
      s.settle(result);
      return result;
    });
  }

  // Copies `text`. With ttl > 0 it schedules the clear; with ttl 0 it only copies (and forgets the
  // previous copy: the clipboard was already overwritten, there is nothing left to clear).
  // Returns { ttlMs, expiresAt, done }. `done` resolves with the clear result.
  function copy(text: string, { sensitive = true, ttlMs: ttl = ttlMs }: { sensitive?: boolean; ttlMs?: number } = {}): Promise<CopyResult> {
    return enqueue(async () => {
      const b = await getBackend();
      await b.write(text, { sensitive }); // if it fails, the previous state (and its timer) remain in effect
      const concealed = !(sensitive && b.degraded === true);
      const prev = state;
      state = null;
      if (prev) {
        if (prev.timer !== undefined) clearTimeout(prev.timer);
        prev.settle('replaced');
      }
      if (!(ttl > 0)) return { concealed, ttlMs: 0, expiresAt: null, done: Promise.resolve('disabled') };
      const myGen = ++gen;
      let settle: (result: ClearResult) => void = () => {};
      const done = new Promise<ClearResult>((r) => (settle = r));
      const pending: PendingClear = { hash: sha256(text), gen: myGen, settle, timer: undefined };
      state = pending;
      pending.timer = setTimeout(() => {
        if (state?.gen === myGen) flush();
      }, ttl);
      return { concealed, ttlMs: ttl, expiresAt: Date.now() + ttl, done };
    });
  }

  return {
    copy,
    flush,
    get pending() {
      return state !== null;
    },
    // Waits for everything already queued (useful in tests and on shutdown).
    idle: () => queue,
  };
}

// The signals that clear the clipboard before exiting, with the exit code each one ends with.
const EXIT_SIGNALS: Readonly<Record<NodeJS.Signals, number>> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

function isSignal(key: string): key is NodeJS.Signals {
  return Object.hasOwn(EXIT_SIGNALS, key);
}

// The part of `process` that installExitHooks uses (tests hand over an EventEmitter).
export interface ExitHookProcess {
  on(event: NodeJS.Signals | 'beforeExit', listener: () => void): void;
  off(event: NodeJS.Signals | 'beforeExit', listener: () => void): void;
  exit(code?: number): never;
}

// Clears on SIGINT/SIGTERM/SIGHUP and on beforeExit, with the same "only if it is still
// the password" rule. Returns a function that removes the handlers. SIGKILL/power loss
// cannot be handled.
export function installExitHooks(
  clipboard: Pick<Clipboard, 'flush' | 'pending'>,
  { proc = process, exit = (code: number) => proc.exit(code) }: { proc?: ExitHookProcess; exit?: (code: number) => void } = {},
): () => void {
  const handlers = Object.entries(EXIT_SIGNALS).map(([sig, code]): [NodeJS.Signals, () => void] => {
    if (!isSignal(sig)) throw coded('err.internal.invalid', `Internal error: invalid signal name "${sig}".`, { what: 'signal name' });
    const h = () => clipboard.flush().finally(() => exit(code));
    proc.on(sig, h);
    return [sig, h];
  });
  const onBeforeExit = (): void => {
    if (clipboard.pending) clipboard.flush();
  };
  proc.on('beforeExit', onBeforeExit);
  return () => {
    for (const [sig, h] of handlers) proc.off(sig, h);
    proc.off('beforeExit', onBeforeExit);
  };
}
