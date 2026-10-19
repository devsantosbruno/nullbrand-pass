// Approximate strength of a typed password (simple heuristic, only for the meters). Pure: no DOM.
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

export type StrengthName = 'weak' | 'medium' | 'strong';
export interface StrengthLevel {
  level: StrengthName;
  // How many of the four segments of the detail pane light up.
  active: 1 | 2 | 3 | 4;
}
export const levelOf = (bits: number): StrengthLevel => ({
  level: bits < 40 ? 'weak' : bits < 70 ? 'medium' : 'strong',
  active: bits < 28 ? 1 : bits < 40 ? 2 : bits < 70 ? 3 : 4,
});
export const strengthLevel = (pw: string): StrengthLevel & { bits: number } => {
  const bits = strength(pw);
  return { bits, ...levelOf(bits) };
};
