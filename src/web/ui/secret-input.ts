// Secrets (master password, card number, CVV, private key...) live in <input type="text" data-masked>. The mask is CSS
// (-webkit-text-security) rather than type="password", which keeps browsers and password managers from offering to save or fill them.
// Where CSS masking is unsupported they fall back to type="password", so a secret is never shown in the clear.
import { queryAll } from '../dom.js';

// Keeps autofill, autocorrect and password-manager extensions away from a masked input. Applied by one function so a new masked field
// cannot forget one. `type="text"`, `data-masked` and `autocomplete="off"` are also in the HTML, so if this code never runs the field
// is still not the type=password that autofill targets.
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

/** Sets the attributes that keep autofill and password managers away from a masked input. */
export function secretInputAttrs(input: HTMLInputElement): void {
  for (const [name, value] of Object.entries(SECRET_ATTRS)) input.setAttribute(name, value);
}

/** Prepares every `input[data-masked]` under `root`. Must run synchronously at boot, before any screen can be shown or focused. */
export function applySecretInputs(root: ParentNode): void {
  for (const input of queryAll(root, 'input[data-masked]', HTMLInputElement)) {
    secretInputAttrs(input);
    if (!canCssMask()) input.type = 'password';
  }
}

/** Returns whether the input currently hides its value. */
export const isMasked = (input: HTMLInputElement): boolean => input.hasAttribute('data-masked');
/** Hides or shows the value of a masked input. */
export function setMasked(input: HTMLInputElement, masked: boolean): void {
  input.toggleAttribute('data-masked', masked);
  if (!canCssMask()) input.type = masked ? 'password' : 'text';
}
