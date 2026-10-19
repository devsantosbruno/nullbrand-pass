// Secrets (master password, card number, CVV, private key...) live in <input type="text" data-masked>: the mask is CSS
// (-webkit-text-security), never type="password", which is what keeps browsers and password managers from offering to save or fill
// them. Only if CSS masking is unsupported do they fall back to type="password", so a secret is never shown in the clear.

import { queryAll } from '../dom.js';

// What keeps autofill, autocorrect and the password managers' extensions away from a masked input (S6). Set by one function, so a new
// masked field cannot forget one. (`type="text"`, `data-masked` and `autocomplete="off"` stay in the HTML as well: if this code never
// runs, the field is still not a type=password that autofill targets.)
const SECRET_ATTRS = {
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  autocomplete: 'off',
  'data-lpignore': 'true',
  'data-1p-ignore': '',
  'data-bwignore': '',
  'data-form-type': 'other',
} as const;

let cssMask: boolean | undefined;
const canCssMask = (): boolean => (cssMask ??= typeof CSS !== 'undefined' && CSS.supports('-webkit-text-security', 'disc'));

export function secretInputAttrs(input: HTMLInputElement): void {
  for (const [name, value] of Object.entries(SECRET_ATTRS)) input.setAttribute(name, value);
}

// Every `input[data-masked]` under `root`. Must run synchronously at boot, before any screen can be shown or focused.
export function applySecretInputs(root: ParentNode): void {
  for (const input of queryAll(root, 'input[data-masked]', HTMLInputElement)) {
    secretInputAttrs(input);
    if (!canCssMask()) input.type = 'password';
  }
}

export const isMasked = (input: HTMLInputElement): boolean => input.hasAttribute('data-masked');
export function setMasked(input: HTMLInputElement, masked: boolean): void {
  input.toggleAttribute('data-masked', masked);
  if (!canCssMask()) input.type = masked ? 'password' : 'text';
}
