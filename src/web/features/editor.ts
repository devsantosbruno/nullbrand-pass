// The detail pane in edit mode: the form for the five item types, its masks and validation, saving and deleting.
// The SSH key part lives in ssh-editor.ts and the folder picker in the folders feature.
import { guardOkResponse, guardVaultItem } from '../api-guards.js';
import { $, $button, $form, expectInstance, el, oneOf, query, queryAll, tx, at, data } from '../dom.js';
import { confirmDelete } from '../dialogs.js';
import { api, msgOf } from '../http.js';
import { IDENTITY_KEYS, IDENTITY_SECTIONS } from '../identity-fields.js';
import { t } from '../locale.js';
import { showDetail } from '../shell.js';
import { state } from '../state.js';
import { toast, toastIfInvalidResponse } from '../toast.js';
import { icon } from '../ui/icons.js';
import { fmtCardExpiry, fmtCardNumber } from '../ui/masks.js';
import { paintMeter } from '../ui/meter.js';
import { createRevealToggle } from '../ui/reveal-toggle.js';
import type { RevealToggle } from '../ui/reveal-toggle.js';
import { isMasked, setMasked } from '../ui/secret-input.js';
import { FIELD_VALIDATORS } from '../ui/validators.js';
import type { ValidatedField } from '../ui/validators.js';
import { isItemType } from '../vault-types.js';
import type { ItemType, VaultItem } from '../vault-types.js';

/** What the editor needs from the other features, as it sees them. Features never import each other, so the page passes in objects with these methods. */
export interface EditorDeps {
  // The folder picker.
  folders: { value(): string; setValue(folder: string): void; closeMenu(): void };
  // The password generator, opened to fill the password field.
  generator: { open(onUse: (password: string) => void): void };
  // The SSH key part of the form.
  ssh: {
    readonly revealToggle: RevealToggle;
    ensureKey(): void;
    reset(): void;
    fill(item: VaultItem | null): void;
    hasKey(): boolean;
    hasPrivateKey(): boolean;
    confirmPubOnly(): Promise<boolean>;
    values(): Readonly<Record<string, string>>;
    repaint(): void;
  };
  select(id: string): Promise<void>;
  renderView(): void;
  renderList(): void;
  refresh(): Promise<void>;
}
/** What the editor exposes to the page. */
export interface EditorHandle {
  /** Rewrites the language-dependent text: title, reveal-button labels and SSH section titles. */
  repaint(): void;
}

// Placeholder per state: bullets while the field is masked, a real example while it is shown.
const SECRET_PLACEHOLDERS = {
  password: ['••••••••', 'my-password-123'],
  cardNumber: ['•••• •••• •••• ••••', '1234 5678 9012 3456'],
  cardCvv: ['•••', '0123'],
} as const;

// Text fields that map to an item property of the same name. Identity fields come from IDENTITY_KEYS and SSH ones from the SSH editor;
// the site (first of a list) and the notes (a textarea) are handled separately.
const PLAIN_FIELDS = ['name', 'username', 'password', 'cardholder', 'cardNumber', 'cardExpiry', 'cardCvv'] as const;

// Fields validated per item type; fields of other types are hidden and do not count.
const VALIDATED_BY_TYPE: Readonly<Record<ItemType, readonly ValidatedField[]>> = {
  login: ['uris'],
  card: ['cardNumber', 'cardExpiry', 'cardCvv'],
  identity: ['email', 'birthDate', 'phone', 'cpf', 'cnpj', 'pis', 'cnh', 'zip'],
  ssh: ['sshHost', 'sshPort'],
  note: [],
};

function buildIdentityForm(): void {
  const host = $('#identity-fields');
  const nodes: HTMLElement[] = [];
  IDENTITY_SECTIONS.forEach((sec, n) => {
    if (n) nodes.push(el('hr'));
    nodes.push(el('div', { className: 'section-title' }, icon(sec.icon), tx(sec.title)));
    for (let k = 0; k < sec.fields.length; k++) {
      const first = at(sec.fields, k);
      const group = first.half && sec.fields[k + 1]?.half ? [first, at(sec.fields, ++k)] : [first];
      const labels = group.map((f) => {
        const input = el('input', { name: f.key, type: f.type || 'text', autocomplete: 'off', maxLength: f.max });
        if (f.mono) input.className = 'mono';
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.placeholderKey) input.dataset['i18nPlaceholder'] = f.placeholderKey;
        if (f.inputmode) input.setAttribute('inputmode', f.inputmode);
        const mask = f.mask;
        if (mask) input.addEventListener('input', () => { input.value = mask(input.value); });
        return el('label', {}, tx(f.label), ' ', input);
      });
      nodes.push(group.length > 1 ? el('div', { className: 'row2' }, ...labels) : at(labels, 0));
    }
  });
  host.replaceChildren(...nodes);
}

function paintEditTitle(item: VaultItem | null = state.editing): void {
  $('#edit-title').textContent = t(item ? 'edit.titleEdit' : 'edit.titleNew');
}

/** Wires the edit form and returns its handle. */
export function initEditor({ folders, generator, ssh, select, renderView, renderList, refresh }: EditorDeps): EditorHandle {
  buildIdentityForm();

  const form = $form('#detail-edit');
  // Controls by name; the identity ones were just built.
  const fieldInput = (name: string): HTMLInputElement => expectInstance(form.elements.namedItem(name), HTMLInputElement, `form field ${name}`);
  const fieldTextarea = (name: string): HTMLTextAreaElement => expectInstance(form.elements.namedItem(name), HTMLTextAreaElement, `form field ${name}`);
  const fieldRadios = (name: string): RadioNodeList => expectInstance(form.elements.namedItem(name), RadioNodeList, `form field ${name}`);
  const fType = fieldRadios('type');
  const fName = fieldInput('name');
  const fPassword = fieldInput('password');
  const fUris = fieldInput('uris');
  const fCardNumber = fieldInput('cardNumber');
  const fCardExpiry = fieldInput('cardExpiry');
  const fCardCvv = fieldInput('cardCvv');
  const fNotes = fieldTextarea('notes');
  const fFavorite = fieldInput('favorite');

  // `newKey` is false when opening a stored item: its key is filled in right after, so generating one here would replace it.
  function setType(type: string, newKey: boolean = true): void {
    query(form, `input[name="type"][value="${type}"]`, HTMLInputElement).checked = true;
    query(form, '.login-only', HTMLElement).hidden = type !== 'login';
    query(form, '.card-only', HTMLElement).hidden = type !== 'card';
    query(form, '.identity-only', HTMLElement).hidden = type !== 'identity';
    query(form, '.ssh-only', HTMLElement).hidden = type !== 'ssh';
    if (type === 'ssh' && newKey) ssh.ensureKey();
  }
  form.addEventListener('change', (e) => {
    const target = e.target;
    if (target instanceof HTMLInputElement && target.name === 'type') setType(target.value);
  });

  fCardNumber.addEventListener('input', () => { fCardNumber.value = fmtCardNumber(fCardNumber.value); });
  fCardExpiry.addEventListener('input', () => { fCardExpiry.value = fmtCardExpiry(fCardExpiry.value); });
  fCardCvv.addEventListener('input', () => { fCardCvv.value = fCardCvv.value.replace(/\D/g, '').slice(0, 4); });

  // One eye per secret field: login password, card number and CVV. The SSH private key's belongs to the SSH editor.
  const passwordToggle = createRevealToggle({ input: fPassword, button: $button('#edit-toggle'), label: (shown) => t(shown ? 'password.hide' : 'password.show'), eyeOff: 'eye-off-wide', iconOptions: { size: 16, strokeWidth: 2 }, placeholders: SECRET_PLACEHOLDERS.password });
  const revealToggles: readonly RevealToggle[] = [
    passwordToggle,
    ...queryAll(form, '[data-reveal]', HTMLButtonElement).map((button) => {
      const name = oneOf(data(button, 'reveal'), ['cardNumber', 'cardCvv'] as const, 'data-reveal');
      return createRevealToggle({
        input: fieldInput(name),
        button,
        label: (shown) => t(`reveal.${name === 'cardCvv' ? 'cvv' : 'cardNumber'}.${shown ? 'hide' : 'show'}`),
        placeholders: SECRET_PLACEHOLDERS[name],
      });
    }),
    ssh.revealToggle,
  ];
  // A secret must not stay visible from a previous item, so opening the editor hides every one.
  const resetSecrets = (): void => { for (const toggle of revealToggles) toggle.setShown(false); };

  function openEditor(item: VaultItem | null): void {
    clearFieldErrors();
    state.editing = item;
    ssh.reset();
    form.reset();
    $('#edit-error').textContent = '';
    paintEditTitle(item);
    $('#btn-delete').hidden = !item;
    resetSecrets();
    setType(item?.type || 'login', !item);
    for (const k of PLAIN_FIELDS) fieldInput(k).value = item?.[k] || '';
    fUris.value = item?.uris?.[0] || '';
    folders.setValue(item?.folder || (state.folder || ''));
    folders.closeMenu();
    for (const k of IDENTITY_KEYS) fieldInput(k).value = item?.[k] || '';
    ssh.fill(item);
    fNotes.value = item?.notes || '';
    fFavorite.checked = Boolean(item?.favorite);
    paintMeter($('#edit-meter'), fPassword.value);
    showDetail('edit');
    fName.focus();
  }

  $('#btn-new').addEventListener('click', () => { state.selectedId = null; renderList(); openEditor(null); });
  $('#btn-edit').addEventListener('click', () => openEditor(state.current));
  $('#btn-cancel').addEventListener('click', () => (state.current && state.selectedId ? renderView() : showDetail(null)));
  fPassword.addEventListener('input', () => paintMeter($('#edit-meter'), fPassword.value));
  $('#edit-generate').addEventListener('click', () => generator.open((pw) => {
    fPassword.value = pw;
    passwordToggle.setShown(true);
    paintMeter($('#edit-meter'), pw);
  }));

  // ---------- Validation ----------
  // Fields with a defined format are checked. An empty field is always accepted; only Name is required.
  function setFieldError(input: HTMLInputElement, msg: string): void {
    const label = expectInstance(input.closest('label'), HTMLLabelElement, 'label of a validated field');
    let hint: Element | null = label.querySelector(':scope > .field-error');
    if (!msg) { hint?.remove(); input.removeAttribute('aria-invalid'); return; }
    if (!hint) { hint = el('small', { className: 'field-error', role: 'alert' }); label.append(hint); }
    hint.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
  }
  function clearFieldErrors(): void {
    form.querySelectorAll('.field-error').forEach((n) => n.remove());
    form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
  }
  function validateForm(): boolean {
    const type = fType.value;
    let first: HTMLInputElement | null = null;
    for (const name of (isItemType(type) ? VALIDATED_BY_TYPE[type] : [])) {
      const input = fieldInput(name);
      const value = input.value;
      const msg = value ? FIELD_VALIDATORS[name](value, t) : '';
      setFieldError(input, msg);
      if (msg && !first) first = input;
    }
    $('#edit-error').textContent = '';
    if (first) {
      if (isMasked(first)) {
        const toggle = revealToggles.find((candidate) => candidate.input === first);
        if (toggle) toggle.setShown(true); else setMasked(first, false);
      }
      first.focus();
    }
    return !first;
  }
  form.addEventListener('input', (e) => {
    const target = e.target;
    if (target instanceof HTMLInputElement && target.getAttribute('aria-invalid')) setFieldError(target, '');
  });

  // ---------- Save / delete ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    if (fType.value === 'ssh') {
      if (!ssh.hasKey()) { $('#edit-error').textContent = t('ssh.needKey'); return; }
      if (!ssh.hasPrivateKey() && !await ssh.confirmPubOnly()) return;
    }
    const payload = {
      type: fType.value,
      ...Object.fromEntries(PLAIN_FIELDS.map((k) => [k, fieldInput(k).value])),
      uris: [fUris.value.trim(), ...(state.editing?.uris || []).slice(1)].filter(Boolean),
      folder: folders.value(),
      ...Object.fromEntries(IDENTITY_KEYS.map((k) => [k, fieldInput(k).value])),
      ...ssh.values(),
      notes: fNotes.value,
      favorite: fFavorite.checked,
    };
    try {
      const saved = state.editing
        ? await api('PUT /api/items/:id', { guard: guardVaultItem, body: payload, path: `/api/items/${encodeURIComponent(state.editing.id)}` })
        : await api('POST /api/items', { guard: guardVaultItem, body: payload });
      await refresh();
      toast(t('common.saved'));
      await select(saved.id);
    } catch (ex) {
      $('#edit-error').textContent = msgOf(ex);
    }
  });

  $('#btn-delete').addEventListener('click', async () => {
    if (!state.editing) return;
    if (!await confirmDelete(
      t('delete.title', { count: 1 }),
      t('delete.single', { name: state.editing.name }),
      t('delete.button', { count: 1 }),
    )) return;
    try {
      await api('DELETE /api/items/:id', { guard: guardOkResponse, path: `/api/items/${encodeURIComponent(state.editing.id)}` });
    } catch (ex) {
      toastIfInvalidResponse(ex);
      return;
    }
    state.selectedId = null;
    state.current = null;
    await refresh();
    showDetail(null);
    toast(t('delete.done', { count: 1 }));
  });

  return {
    repaint: () => {
      ssh.repaint();
      paintEditTitle(state.editing);
      for (const toggle of revealToggles) toggle.repaint();
    },
  };
}
