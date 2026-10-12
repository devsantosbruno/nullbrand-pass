// Gerador de senhas com sorteio uniforme (crypto.randomInt, sem viés de módulo).
import { randomInt } from 'node:crypto';

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
};
const AMBIGUOUS = /[Il1O0o]/g;

export const DEFAULT_OPTIONS = Object.freeze({
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
});

export function generatePassword(opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const length = Math.max(4, Math.min(128, Number.parseInt(o.length, 10) || DEFAULT_OPTIONS.length));
  const groups = Object.keys(SETS)
    .filter((k) => o[k])
    .map((k) => (o.avoidAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
  if (groups.length === 0) throw new Error('Escolha ao menos um tipo de caractere.');

  const all = groups.join('');
  // Garante pelo menos um caractere de cada grupo escolhido.
  const chars = groups.map((g) => g[randomInt(g.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Embaralha (Fisher-Yates).
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Entropia aproximada (bits) supondo sorteio uniforme no alfabeto escolhido.
export function entropyBits(opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const size = Object.keys(SETS)
    .filter((k) => o[k])
    .reduce((n, k) => n + (o.avoidAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]).length, 0);
  return size ? Math.round(o.length * Math.log2(size)) : 0;
}
