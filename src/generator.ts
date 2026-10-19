// Password generator with uniform sampling (crypto.randomInt, no modulo bias).
import { coded } from './errors.js';
import { randomInt } from 'node:crypto';
import { spreadOf } from './shared/guards.js';

/** Password generator settings. */
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

function isSetName(key: string): key is SetName {
  return Object.hasOwn(SETS, key);
}

/** Settings used for any option the caller leaves out. */
export const DEFAULT_OPTIONS: Readonly<GeneratorOptions> = Object.freeze({
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
});

// Length of the generated password: a numeric string is accepted, a non-number falls back to the default, and the result is clamped to
// 4..128. Shared with entropyBits() so `bits` describes the password actually generated.
function effectiveLength(o: Record<string, unknown>): number {
  return Math.max(4, Math.min(128, Number.parseInt(`${o['length']}`, 10) || DEFAULT_OPTIONS.length));
}

/**
 * Generates a random password with uniform sampling (`crypto.randomInt`, no modulo bias) and at least one character from each chosen group.
 * @param opts untrusted: CLI flags (the length may be the string "16") or a JSON body; merged over {@link DEFAULT_OPTIONS}.
 * @throws coded `err.gen.noCharset` when no character type is enabled.
 */
export function generatePassword(opts: unknown = {}): string {
  const o: Record<string, unknown> = { ...DEFAULT_OPTIONS, ...spreadOf(opts) };
  const length = effectiveLength(o);
  const groups = Object.keys(SETS)
    .filter(isSetName)
    .filter((k) => o[k])
    .map((k) => (o['avoidAmbiguous'] ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
  if (groups.length === 0) throw coded('err.gen.noCharset', 'Choose at least one character type.');

  const all = groups.join('');
  // One guaranteed character per group, then the rest from the whole pool.
  const chars: (string | undefined)[] = groups.map((g) => g[randomInt(g.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Fisher-Yates shuffle, so the guaranteed characters are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Returns the approximate entropy in bits of a password generated with `opts`, assuming uniform sampling over the chosen alphabet. */
export function entropyBits(opts: unknown = {}): number {
  const o: Record<string, unknown> = { ...DEFAULT_OPTIONS, ...spreadOf(opts) };
  const size = Object.keys(SETS)
    .filter(isSetName)
    .filter((k) => o[k])
    .reduce((n, k) => n + (o['avoidAmbiguous'] ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]).length, 0);
  return size ? Math.round(effectiveLength(o) * Math.log2(size)) : 0;
}
