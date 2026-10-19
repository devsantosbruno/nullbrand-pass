// Clipboard with automatic clearing, in two layers: per-platform backends (native subprocesses) and createClipboard(), the timer
// logic with the "only clear if it is still the password" rule, which takes the backend as a parameter so tests never touch the real one.
// Text always goes to the subprocess through stdin (arguments show up in ps and /proc), never through a shell, and the manager only
// keeps the SHA-256 of what it copied.
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { coded } from './errors.js';
import { errorMessage } from './shared/guards.js';
import type { TranslateParams } from './shared/i18n.js';
import type { SpawnFn } from './system.js';

/** How long a sensitive copy stays on the clipboard before it is cleared. */
export const DEFAULT_TTL_MS = 30_000;

/** Clipboard failure carrying an i18n `key` and `params`. */
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

/** Options for {@link run}. */
export interface RunOptions {
  /** Written to stdin. */
  input?: string | Uint8Array;
  /** Collect and return stdout. Leave off for writes: xclip and wl-copy stay alive holding the selection, so an open pipe would stall `close`. */
  capture?: boolean;
  /** Replaces `spawn` in tests. */
  spawnFn?: SpawnFn;
}
/** How a backend runs a command; injectable for tests. */
export type Exec = (cmd: string, args: readonly string[], options?: RunOptions) => Promise<string>;

/**
 * Runs a command without a shell, passing `input` through stdin only so it never shows up in the process list.
 * @returns stdout when `capture` is set, else an empty string.
 * @throws {ClipboardError} if the command cannot start, has no stdin pipe, or exits non-zero.
 */
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
    // Without a stdin pipe the text cannot reach the tool: report it rather than no-op, and stop the child so it does not wait forever.
    const stdin = child.stdin;
    if (!stdin) {
      child.kill();
      return reject(new ClipboardError(`Could not run ${cmd}: no stdin pipe.`, 'err.clipboard.run', { cmd, reason: 'no stdin pipe' }));
    }
    // EPIPE when the process exits before reading everything; the exit code already reports it.
    stdin.on('error', () => {});
    stdin.end(input ?? '');
  });
}

// Returns whether `cmd` is an executable file in one of the PATH directories.
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
/** A platform clipboard: write, read back (to verify before clearing) and clear. */
export interface Backend {
  name: string;
  /** Set by `write`: true when a sensitive write could not be marked concealed and fell back to a plain copy. */
  degraded?: boolean;
  write(text: string, options?: { sensitive?: boolean }): Promise<string>;
  read(): Promise<string>;
  clear(): Promise<string>;
}

// Writes stdin to the pasteboard and declares org.nspasteboard.ConcealedType, which clipboard history managers respect.
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

/** macOS backend (pbcopy/pbpaste). Sensitive writes go through osascript so history managers skip them, falling back to pbcopy and setting `degraded`. */
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
          // Still copied, but history managers will see it; copy() reports this.
          backend.degraded = true;
        }
      }
      return exec('pbcopy', [], { input: text });
    },
    read: () => exec('pbpaste', [], { capture: true }),
    clear: () => exec('pbcopy', [], { input: '' }),
  };
  return backend;
}

// clip.exe reads stdin in the OEM code page, which mangles accents, but accepts UTF-16LE when the text starts with a BOM.
// Reading and clearing use fixed PowerShell commands, so no user data reaches a command line.
// Windows sensitive writes are not marked (ExcludeClipboardContentFromMonitorProcessing needs P/Invoke); documented in SECURITY.md.
const PS_READ = '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; [Console]::Out.Write((Get-Clipboard -Raw))';
const PS_CLEAR = 'Set-Clipboard -Value $null';
const PS_ARGS = (command: string): string[] => ['-NoProfile', '-NonInteractive', '-Command', command];

/** Windows backend (clip.exe for writes, PowerShell for read and clear). */
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

/** Wayland backend (wl-copy/wl-paste). */
export function waylandBackend(exec: Exec = run): Backend {
  return {
    name: 'Wayland (wl-copy)',
    write: (text) => exec('wl-copy', [], { input: text }),
    read: () => exec('wl-paste', ['--no-newline'], { capture: true }),
    clear: () => exec('wl-copy', ['--clear']),
  };
}

/** X11 backend using xclip. */
export function xclipBackend(exec: Exec = run): Backend {
  return {
    name: 'X11 (xclip)',
    write: (text) => exec('xclip', ['-selection', 'clipboard'], { input: text }),
    read: () => exec('xclip', ['-selection', 'clipboard', '-o'], { capture: true }),
    clear: () => exec('xclip', ['-selection', 'clipboard'], { input: '' }),
  };
}

/** X11 backend using xsel. */
export function xselBackend(exec: Exec = run): Backend {
  return {
    name: 'X11 (xsel)',
    write: (text) => exec('xsel', ['--clipboard', '--input'], { input: text }),
    read: () => exec('xsel', ['--clipboard', '--output'], { capture: true }),
    clear: () => exec('xsel', ['--clipboard', '--clear']),
  };
}

/** Options for {@link detectBackend}; all of them are injectable for tests. */
export interface DetectOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Tells whether a command is installed. */
  has?: (cmd: string) => Promise<boolean>;
}

/**
 * Picks the backend for the current platform.
 * @throws {ClipboardError} when there is no graphical session or no clipboard tool is installed.
 */
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

/**
 * How a copy ended:
 * - `cleared`: the clipboard still held the password and was cleared.
 * - `changed`: the user copied something else meanwhile; left alone.
 * - `unverified`: the clipboard could not be read, so it is not cleared blindly.
 * - `failed`: it still held the password and clearing failed.
 * - `replaced`: a newer copy took over.
 */
export type ClearResult = 'cleared' | 'changed' | 'unverified' | 'failed' | 'replaced';

/** What the serialized copy/clear operations resolve with. */
export type Settled = CopyResult | ClearResult | 'none' | void;

/** Outcome of {@link Clipboard.copy}. */
export interface CopyResult {
  /** False when a sensitive copy could not be hidden from clipboard history managers (macOS fallback to pbcopy). */
  concealed: boolean;
  /** 0 when no clear is scheduled. */
  ttlMs: number;
  /** Epoch ms of the scheduled clear, or `null`. */
  expiresAt: number | null;
  /** Settles when the copy ends; `disabled` means no timer was set. */
  done: Promise<ClearResult | 'disabled'>;
}
/** A clipboard that clears what it copied. */
export interface Clipboard {
  copy(text: string, options?: { sensitive?: boolean; ttlMs?: number }): Promise<CopyResult>;
  flush(): Promise<ClearResult | 'none'>;
  readonly pending: boolean;
  idle(): Promise<Settled>;
}
/** Options for {@link createClipboard}. */
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

/**
 * Creates a clipboard manager. Copy and clear operations are serialized, and a clear only happens if the clipboard
 * still holds the copied text (compared by SHA-256), so something the user copied afterwards is never wiped.
 */
export function createClipboard({ backend, ttlMs = DEFAULT_TTL_MS }: ClipboardOptions = {}): Clipboard {
  let resolved: Backend | null = null;
  let state: PendingClear | null = null;
  let gen = 0;
  // Serializes copy and clear so one does not step on the other.
  let queue: Promise<Settled> = Promise.resolve();

  const getBackend = async (): Promise<Backend> => {
    if (!resolved) resolved = typeof backend === 'function' ? await backend() : backend ? backend : await detectBackend();
    return resolved;
  };
  const enqueue = <T extends Settled>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  // Clears only if the current content is still what we copied. The state is dropped before any await,
  // so repeated calls (signal + beforeExit) do not clear twice.
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
        // No backend or no way to read: nothing was verified.
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

  // With ttl > 0 it schedules the clear. With ttl 0 it only copies and forgets the previous copy, which is already overwritten.
  function copy(text: string, { sensitive = true, ttlMs: ttl = ttlMs }: { sensitive?: boolean; ttlMs?: number } = {}): Promise<CopyResult> {
    return enqueue(async () => {
      const b = await getBackend();
      // If this fails, the previous state and its timer stay in effect.
      await b.write(text, { sensitive });
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
    // Waits for everything already queued.
    idle: () => queue,
  };
}

// Signals that clear the clipboard before exiting, with the conventional 128+n exit code of each.
const EXIT_SIGNALS: Readonly<Record<NodeJS.Signals, number>> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

function isSignal(key: string): key is NodeJS.Signals {
  return Object.hasOwn(EXIT_SIGNALS, key);
}

/** The part of `process` that {@link installExitHooks} uses; tests pass an EventEmitter. */
export interface ExitHookProcess {
  on(event: NodeJS.Signals | 'beforeExit', listener: () => void): void;
  off(event: NodeJS.Signals | 'beforeExit', listener: () => void): void;
  exit(code?: number): never;
}

/**
 * Clears the clipboard on SIGINT/SIGTERM/SIGHUP and on beforeExit, under the same "only if it is still the password" rule.
 * SIGKILL and power loss cannot be handled.
 * @returns a function that removes the handlers.
 */
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
