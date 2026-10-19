// Input masks of the editor: each takes what was typed and returns what the field should show.
// Pure: no DOM, no translation; they never throw and never log their input.
/** Strips everything but digits. */
export const onlyDigits = (v: string): string => v.replace(/\D/g, '');
/** Builds a mask that keeps at most `max` digits. */
export const digits = (max: number) => (v: string): string => onlyDigits(v).slice(0, max);
/** Builds a mask that fills a `#` pattern such as `###.###.###-##` with the typed digits. */
export const maskDigits = (pattern: string) => (v: string): string => {
  const n = (pattern.match(/#/g) || []).length;
  const d = onlyDigits(v).slice(0, n);
  let out = '', k = 0;
  for (const ch of pattern) { if (k >= d.length) break; out += ch === '#' ? d.charAt(k++) : ch; }
  return out;
};
/** Masks a DD/MM/YYYY date: day 01-31, month 01-12, year from (current year - 200) to (current year + 1). */
export const maskDate = (v: string, now = new Date().getFullYear()): string => {
  let d = onlyDigits(v).slice(0, 8);
  if (d.length && d.charAt(0) > '3') d = `0${d}`;
  if (d.length >= 2) d = String(Math.min(31, Math.max(1, Number(d.slice(0, 2))))).padStart(2, '0') + d.slice(2);
  if (d.length >= 3 && d.charAt(2) > '1') d = `${d.slice(0, 2)}0${d.slice(2)}`;
  if (d.length >= 4) d = d.slice(0, 2) + String(Math.min(12, Math.max(1, Number(d.slice(2, 4))))).padStart(2, '0') + d.slice(4);
  if (d.length === 8) d = d.slice(0, 4) + Math.min(now + 1, Math.max(now - 200, Number(d.slice(4))));
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
};
/** Masks a Brazilian phone as `(12) 34567-8910`; a 10-digit landline becomes `(12) 3456-7891`. */
export const maskPhone = (v: string): string => {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  const split = d.length > 10 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, split)}${d.length > split ? `-${d.slice(split)}` : ''}`;
};
/** Formats up to 16 digits in groups of four. */
export const fmtCardNumber = (v: string): string => digits(16)(v).replace(/(\d{4})(?=\d)/g, '$1 ');
/** Masks a card expiry as MM/YYYY: month 01-12, year from `min` (default: the current year) to `min` + 100. */
export const fmtCardExpiry = (v: string, min = new Date().getFullYear()): string => {
  let d = onlyDigits(v);
  if (d.length && d.charAt(0) > '1') d = `0${d}`;
  d = d.slice(0, 6);
  if (d.length >= 2) {
    let m = Number(d.slice(0, 2));
    m = Math.min(12, Math.max(1, m));
    d = String(m).padStart(2, '0') + d.slice(2);
  }
  if (d.length === 6) {
    const y = Math.min(min + 100, Math.max(min, Number(d.slice(2))));
    d = d.slice(0, 2) + y;
  }
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
