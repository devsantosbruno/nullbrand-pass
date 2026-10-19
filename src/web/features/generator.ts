// The password generator dialog: from the sidebar, or from the editor, where "Use" hands the password back.
import type { GenerateRequest } from '../api.js';
import { guardGenerateResponse } from '../api-guards.js';
import { $, $dialog, $input, el, textOf } from '../dom.js';
import { api, msgOf } from '../http.js';
import { t } from '../locale.js';
import { copy } from '../clipboard.js';

/** What the generator exposes to the page. */
export interface GeneratorHandle {
  /** Opens the dialog. `onUse` makes the "Use" button appear and receives the password shown. */
  open(onUse?: (password: string) => void): void;
  /** Regenerates the strength line in the new language, if the dialog is open. */
  repaint(): void;
}

const clampLen = (v: string | number): number => Math.max(8, Math.min(128, Math.round(Number(v)) || 20));

// Colors digits and symbols; the element's textContent stays the plain password.
function renderGen(password: string): void {
  const out = $('#gen-output');
  out.textContent = '';
  for (const ch of password) {
    const kind = /[0-9]/.test(ch) ? 'num' : /[\p{L}]/u.test(ch) ? '' : 'sym';
    out.append(kind ? el('span', { className: 'ch-' + kind, textContent: ch }) : document.createTextNode(ch));
  }
}

/** Wires the generator dialog and returns its handle. */
export function initGenerator(): GeneratorHandle {
  const dlg = $dialog('#dlg-generator');
  let useCallback: ((password: string) => void) | null = null;
  const length = $input('#gen-length');
  const lenNum = $input('#gen-len-num');

  const options = (): GenerateRequest => ({
    length: clampLen(lenNum.value),
    upper: $input('#gen-upper').checked,
    lower: $input('#gen-lower').checked,
    digits: $input('#gen-digits').checked,
    symbols: $input('#gen-symbols').checked,
    avoidAmbiguous: $input('#gen-ambig').checked,
  });
  async function regen(): Promise<void> {
    try {
      const r = await api('POST /api/generate', { guard: guardGenerateResponse, body: options() });
      renderGen(r.password);
      $('#gen-bits').textContent = t('gen.bits', { bits: r.bits });
    } catch (ex) {
      $('#gen-output').textContent = '';
      $('#gen-bits').textContent = msgOf(ex);
    }
  }
  function open(onUse: ((password: string) => void) | null = null): void {
    useCallback = onUse;
    $('#gen-use').hidden = !onUse;
    dlg.showModal();
    void regen();
  }

  dlg.addEventListener('input', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === 'gen-length') lenNum.value = target.value;
    else if (target.id === 'gen-len-num') {
      if (target.value === '') return;
      length.value = String(clampLen(target.value));
    }
    void regen();
  });
  // Leaving the numeric field fixes out-of-range values.
  lenNum.addEventListener('change', () => {
    lenNum.value = String(clampLen(lenNum.value));
    length.value = lenNum.value;
    void regen();
  });
  // Enter in an input would trigger the form's implicit submit (method=dialog) and close the modal.
  dlg.addEventListener('keydown', (e) => {
    const target = e.target;
    if (e.key === 'Enter' && target instanceof HTMLInputElement) {
      e.preventDefault();
      if (target.id === 'gen-len-num') target.dispatchEvent(new Event('change'));
    }
  });
  $('#gen-regen').addEventListener('click', () => { void regen(); });
  $('#gen-copy').addEventListener('click', () => copy(textOf($('#gen-output')), t('field.password'), { sensitive: true }));
  $('#gen-use').addEventListener('click', () => { useCallback?.(textOf($('#gen-output'))); dlg.close(); });
  $('#btn-generator').addEventListener('click', () => open());

  return { open, repaint: () => { if (dlg.open) void regen(); } };
}
