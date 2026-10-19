// The identity item type as data: its sections and fields drive both the viewer (what to list) and the editor (what to build).
import type { IdentityKey } from './vault-types.js';
import type { IconName } from './ui/icons.js';
import { digits, maskDate, maskDigits, maskPhone } from './ui/masks.js';

export interface IdentityField {
  key: IdentityKey;
  label: string;
  max: number;
  type?: string;
  inputmode?: string;
  placeholder?: string;
  placeholderKey?: string;
  mono?: boolean;
  mask?: (v: string) => string;
  half?: boolean;
}
export interface IdentitySection {
  title: string;
  icon: IconName;
  fields: IdentityField[];
}
export const IDENTITY_SECTIONS: IdentitySection[] = [
  { title: 'identity.personal', icon: 'user', fields: [
    { key: 'fullName', label: 'field.fullName', max: 128, placeholder: 'Jane Doe' },
    { key: 'email', label: 'field.email', max: 254, type: 'email', inputmode: 'email', placeholder: 'jane@example.com' },
    { key: 'birthDate', label: 'field.birthDate', max: 10, mono: true, placeholderKey: 'placeholder.date', mask: maskDate, inputmode: 'numeric', half: true },
    { key: 'phone', label: 'field.phone', max: 15, mono: true, mask: maskPhone, type: 'tel', inputmode: 'tel', placeholder: '(12) 34567-8910', half: true },
  ] },
  { title: 'identity.documents', icon: 'id', fields: [
    { key: 'cpf', label: 'field.cpf', max: 14, mono: true, placeholder: '000.000.000-00', mask: maskDigits('###.###.###-##'), inputmode: 'numeric', half: true },
    { key: 'rg', label: 'field.rg', max: 32, mono: true, placeholder: '12.345.678-9', half: true },
    { key: 'cnh', label: 'field.cnh', max: 20, mono: true, placeholder: '12345678901', mask: digits(11), inputmode: 'numeric', half: true },
    { key: 'passport', label: 'field.passport', max: 20, mono: true, placeholder: 'AB123456', half: true },
    { key: 'pis', label: 'field.pis', max: 14, mono: true, placeholder: '000.00000.00-0', mask: maskDigits('###.#####.##-#'), inputmode: 'numeric', half: true },
    { key: 'cnpj', label: 'field.cnpj', max: 18, mono: true, placeholder: '00.000.000/0000-00', mask: maskDigits('##.###.###/####-##'), inputmode: 'numeric', half: true },
  ] },
  { title: 'identity.address', icon: 'pin', fields: [
    { key: 'address', label: 'field.address', max: 256, placeholder: '123 Main St, Apt 45' },
    { key: 'city', label: 'field.city', max: 128, placeholder: 'São Paulo', half: true },
    { key: 'state', label: 'field.state', max: 64, placeholder: 'SP', half: true },
    { key: 'zip', label: 'field.zip', max: 9, mono: true, placeholder: '00000-000', mask: maskDigits('#####-###'), inputmode: 'numeric', half: true },
    { key: 'country', label: 'field.country', max: 64, placeholder: 'Brazil', half: true },
  ] },
];
export const IDENTITY_KEYS: IdentityKey[] = IDENTITY_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
