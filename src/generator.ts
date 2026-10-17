// Password generator with uniform sampling (crypto.randomInt, no modulo bias).
import { coded } from './errors.js';
import { randomInt } from 'node:crypto';
import { spreadOf } from './shared/guards.js';

export interface GeneratorOptions {
  readonly length: number;
  readonly lower: boolean;
  readonly upper: boolean;
  readonly digits: boolean;
  readonly symbols: boolean;
  readonly avoidAmbiguous: boolean;
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
};
type SetName = keyof typeof SETS;
const AMBIGUOUS = /[Il1O0o]/g;

// Keeps only the keys of SETS (own keys, in insertion order: lower, upper, digits, symbols).
function isSetName(key: string): key is SetName {
  return Object.hasOwn(SETS, key);
}

export const DEFAULT_OPTIONS: Readonly<GeneratorOptions> = Object.freeze({
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
});

// The length of the password generatePassword() builds for these (already merged) options: a "16" string is accepted, anything that is not a
// number falls back to the default, and the result is clamped to 4..128. entropyBits() uses it too so `bits` describes the password generated.
function effectiveLength(o: Record<string, unknown>): number {
  return Math.max(4, Math.min(128, Number.parseInt(`${o['length']}`, 10) || DEFAULT_OPTIONS.length));
}

// `opts` is whatever the caller has: the CLI's flags (a length may be the string "16"), or the JSON body of POST /api/generate (any JSON
// value at all). It is merged over the defaults exactly as `{ ...DEFAULT_OPTIONS, ...opts }` did, and read value by value below.
export function generatePassword(opts: unknown = {}): string {
  const o: Record<string, unknown> = { ...DEFAULT_OPTIONS, ...spreadOf(opts) };
  const length = effectiveLength(o);
  const groups = Object.keys(SETS)
    .filter(isSetName)
    .filter((k) => o[k])
    .map((k) => (o['avoidAmbiguous'] ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
  if (groups.length === 0) throw coded('err.gen.noCharset', 'Choose at least one character type.');

  const all = groups.join('');
  // Guarantees at least one character from each chosen group.
  const chars: (string | undefined)[] = groups.map((g) => g[randomInt(g.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Shuffles (Fisher-Yates).
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Approximate entropy (bits) assuming uniform sampling over the chosen alphabet.
export function entropyBits(opts: unknown = {}): number {
  const o: Record<string, unknown> = { ...DEFAULT_OPTIONS, ...spreadOf(opts) };
  const size = Object.keys(SETS)
    .filter(isSetName)
    .filter((k) => o[k])
    .reduce((n, k) => n + (o['avoidAmbiguous'] ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]).length, 0);
  return size ? Math.round(effectiveLength(o) * Math.log2(size)) : 0;
}
