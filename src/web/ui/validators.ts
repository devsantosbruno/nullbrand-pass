// Validation of the editor's fields that have a defined format. An empty field is always accepted (the caller only runs these on a value);
// only Name is required. Each returns '' when valid, or the translated message. Pure: no DOM; the translator comes in as `say`.
// A message never contains the value that was typed (S3): only the field's label and fixed limits.
import { onlyDigits } from './masks.js';

export type Say = (key: string, params?: Readonly<Record<string, string | number>>) => string;
export type Validator = (v: string, say: Say) => string;

const exactDigits = (n: number, labelKey: string): Validator => (v, say) => (onlyDigits(v).length === n ? '' : say('val.digits', { label: say(labelKey), n }));

export const luhn = (num: string): boolean => {
  let sum = 0;
  [...num].reverse().forEach((ch, k) => { let d = Number(ch); if (k % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; });
  return sum % 10 === 0;
};
// Check digits for CPF/CNPJ (Brazilian taxpayer IDs); repeated sequences (111.111.111-11) are invalid.
const checkDigit = (nums: readonly number[], weights: readonly number[]): number => {
  const r = nums.reduce((acc, n, k) => acc + n * (weights[k] ?? 0), 0) % 11;
  return r < 2 ? 0 : 11 - r;
};
export const validCpf = (d: string): boolean => {
  if (/^(\d)\1+$/.test(d)) return false;
  const n = [...d].map(Number);
  return checkDigit(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === n[9] && checkDigit(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === n[10];
};
export const validCnpj = (d: string): boolean => {
  if (/^(\d)\1+$/.test(d)) return false;
  const n = [...d].map(Number);
  return checkDigit(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === n[12] && checkDigit(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === n[13];
};

export type ValidatedField = 'uris' | 'cardNumber' | 'cardExpiry' | 'cardCvv' | 'email' | 'birthDate' | 'phone' | 'cpf' | 'cnpj' | 'pis' | 'cnh' | 'zip' | 'sshHost' | 'sshPort';
export const FIELD_VALIDATORS: Readonly<Record<ValidatedField, Validator>> = {
  uris: (v, say) => {
    const site = v.trim();
    if (/\s/.test(site)) return say('val.noSpaces');
    try {
      const u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(site) ? site : `https://${site}`);
      const h = u.hostname;
      return h === 'localhost' || /^[\d.]+$/.test(h) || /^\[.*\]$/.test(h) || /^[^.]+(\.[^.]+)+$/.test(h) ? '' : say('val.website');
    } catch { return say('val.website'); }
  },
  cardNumber: (v, say) => {
    const d = onlyDigits(v);
    if (d.length < 13 || d.length > 16) return say('val.cardIncomplete');
    return luhn(d) ? '' : say('val.cardInvalid');
  },
  cardExpiry: (v, say) => {
    const m = /^(\d{2})\/(\d{4})$/.exec(v);
    if (!m) return say('val.expiryIncomplete');
    return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? '' : say('val.expiryMonth');
  },
  cardCvv: (v, say) => (/^\d{3,4}$/.test(v) ? '' : say('val.cvv')),
  email: (v, say) => (v.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v) ? '' : say('val.email')),
  birthDate: (v, say) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
    if (!m) return say('val.dateIncomplete');
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])] as const;
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? '' : say('val.dateInvalid');
  },
  phone: (v, say) => {
    const n = onlyDigits(v).length;
    return n === 10 || n === 11 ? '' : say('val.phone');
  },
  cpf: (v, say) => {
    const d = onlyDigits(v);
    if (d.length !== 11) return say('val.cpfIncomplete');
    return validCpf(d) ? '' : say('val.cpfInvalid');
  },
  cnpj: (v, say) => {
    const d = onlyDigits(v);
    if (d.length !== 14) return say('val.cnpjIncomplete');
    return validCnpj(d) ? '' : say('val.cnpjInvalid');
  },
  pis: exactDigits(11, 'field.pis'),
  cnh: exactDigits(11, 'field.cnh'),
  zip: exactDigits(8, 'field.zip'),
  sshHost: (v, say) => (/^[^\s@/]+$/.test(v.trim()) ? '' : say('val.host')),
  sshPort: (v, say) => (Number(v) >= 1 && Number(v) <= 65535 ? '' : say('val.port')),
};
