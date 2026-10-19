import { strengthLevel } from './strength.js';

/** Paints the thin bar under a password field: as wide, and as red/amber/green, as the password is strong. */
export function paintMeter(span: HTMLElement, pw: string): void {
  const { bits, level } = strengthLevel(pw);
  const pct = Math.min(100, (bits / 100) * 100);
  span.style.width = `${pct}%`;
  span.style.background = level === 'weak' ? 'var(--err)' : level === 'medium' ? 'var(--warn)' : 'var(--ok)';
}
