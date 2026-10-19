/** Estimates a typed password's strength in bits with a simple heuristic. Only for the meters; pure, no DOM. */
export function strength(pw: string): number {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 30;
  const unique = new Set(pw).size;
  return Math.round(Math.min(pw.length, unique * 1.5) * Math.log2(Math.max(pool, 2)));
}

/** Strength band. */
export type StrengthName = 'weak' | 'medium' | 'strong';
/** A strength band and how many of the detail pane's four segments light up. */
export interface StrengthLevel {
  level: StrengthName;
  active: 1 | 2 | 3 | 4;
}
/** Maps bits to a {@link StrengthLevel}. */
export const levelOf = (bits: number): StrengthLevel => ({
  level: bits < 40 ? 'weak' : bits < 70 ? 'medium' : 'strong',
  active: bits < 28 ? 1 : bits < 40 ? 2 : bits < 70 ? 3 : 4,
});
/** Combines {@link strength} and {@link levelOf}. */
export const strengthLevel = (pw: string): StrengthLevel & { bits: number } => {
  const bits = strength(pw);
  return { bits, ...levelOf(bits) };
};
