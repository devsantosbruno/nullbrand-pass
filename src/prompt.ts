// Terminal prompts with hidden input for passwords. Works with a TTY and with redirected stdin.
import { createInterface, type Interface } from 'node:readline';
import { coded } from './errors.js';

let rl: Interface | null = null;
// Whether the echo of typed text can be suppressed (see ensure()).
let maskable = false;
let muted = false;
// Set once the input ended: a later ask() has nothing to wait for.
let closed = false;
const queue: string[] = [];
const waiters: { resolve: (line: string) => void; reject: (err: Error) => void }[] = [];

function ensure(): Interface {
  if (rl) return rl;
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const created = createInterface({ input: process.stdin, output: process.stdout, terminal });
  rl = created;
  // Hiding input relies on the private, undocumented readline method _writeToOutput. If a Node release drops it, `maskable` stays
  // false and ask() refuses to prompt for a password rather than echo it.
  const original = created._writeToOutput;
  maskable = typeof original === 'function';
  if (typeof original === 'function') {
    const write = original.bind(created);
    created._writeToOutput = (s: string) => {
      if (!muted) return write(s);
      if (s.includes('\n') || s.includes('\r')) write('\n');
    };
  }
  created.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(line);
    else queue.push(line);
  });
  created.on('close', () => {
    closed = true;
    for (let waiter = waiters.shift(); waiter; waiter = waiters.shift()) {
      waiter.reject(coded('err.inputClosed', 'Input closed.'));
    }
  });
  return created;
}

function nextLine(): Promise<string> {
  const next = queue.shift();
  if (next !== undefined) return Promise.resolve(next);
  // After close nothing would ever resolve a new waiter: fail now instead of hanging.
  if (closed) return Promise.reject(coded('err.inputClosed', 'Input closed.'));
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

/**
 * Asks one question and resolves with the next input line.
 * @param hidden suppress the echo of what is typed (passwords).
 * @throws coded `err.prompt.cannotMask` if the echo cannot be suppressed, so a password is never asked in the clear; `err.inputClosed` at end of input.
 */
export async function ask(question: string, { hidden = false }: { hidden?: boolean } = {}): Promise<string> {
  ensure();
  if (hidden && !maskable) throw coded('err.prompt.cannotMask', 'Cannot hide the password as you type in this terminal, so it will not be asked.');
  if (closed && queue.length === 0) throw coded('err.inputClosed', 'Input closed.');
  process.stdout.write(question);
  muted = hidden;
  try {
    return await nextLine();
  } finally {
    muted = false;
  }
}

/** Asks a yes/no question. Accepts `y`, `yes` and any word in `yes` (for translated answers); anything else is no. */
export async function confirm(question: string, { suffix = '[y/N]', yes = [] }: { suffix?: string; yes?: readonly string[] } = {}): Promise<boolean> {
  const a = (await ask(`${question} ${suffix} `)).trim().toLowerCase();
  return a === 'y' || a === 'yes' || yes.includes(a);
}

/** Closes the shared readline interface so the process can exit. */
export function closePrompt(): void {
  rl?.close();
  rl = null;
  closed = false;
}
