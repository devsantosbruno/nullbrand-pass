// Prompts de terminal (com entrada oculta para senhas). Funciona com TTY e com stdin redirecionado.
import { createInterface } from 'node:readline';

let rl = null;
let muted = false;
const queue = [];
const waiters = [];

function ensure() {
  if (rl) return;
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  rl = createInterface({ input: process.stdin, output: process.stdout, terminal });
  const write = rl._writeToOutput?.bind(rl);
  if (write) {
    rl._writeToOutput = (s) => {
      if (!muted) return write(s);
      if (s.includes('\n') || s.includes('\r')) write('\n');
    };
  }
  rl.on('line', (line) => (waiters.length ? waiters.shift().resolve(line) : queue.push(line)));
  rl.on('close', () => {
    while (waiters.length) waiters.shift().reject(new Error('Entrada encerrada.'));
  });
}

function nextLine() {
  if (queue.length) return Promise.resolve(queue.shift());
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

export async function ask(question, { hidden = false } = {}) {
  ensure();
  process.stdout.write(question);
  muted = hidden;
  try {
    return await nextLine();
  } finally {
    muted = false;
  }
}

export async function confirm(question) {
  const a = (await ask(`${question} [s/N] `)).trim().toLowerCase();
  return a === 's' || a === 'sim' || a === 'y' || a === 'yes';
}

export function closePrompt() {
  rl?.close();
  rl = null;
}
