// Modal dialogs. `confirm()` builds a confirmation dialog on the spot (title, text, Cancel / OK) and removes it when it closes;
// `openDialog()` is the promise form of showModal() for the dialogs that stay in the HTML because they hold form fields.
import { el } from '../dom.js';

// Opens a dialog from the HTML and resolves with its returnValue when it closes ('' for Esc and for close() without a value).
// The value is reset first, so a previous answer can never be read as this one.
export function openDialog(dlg: HTMLDialogElement): Promise<string> {
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
}

export interface ConfirmOptions {
  title: string;
  // Text as written, or already-built nodes (e.g. rich() output). Never HTML: it all goes in through textContent / append (S1).
  body: string | readonly (string | HTMLElement)[];
  okLabel: string;
  // Passed in, not read from the dictionary here: ui/ does not know the language.
  cancelLabel: string;
  tone?: 'primary' | 'danger';
  // Where the focus starts. Cancel by default (S9): Enter must not confirm something destructive by accident.
  initialFocus?: 'cancel' | 'ok';
}

// dialog > .dialog-body > h2 + p + .actions(span.grow + button.btn.ghost + button.btn.<tone>): the markup the CSS was written for.
function present({ title, body, okLabel, cancelLabel, tone = 'primary', initialFocus = 'cancel' }: ConfirmOptions): Promise<boolean> {
  const cancel = el('button', { className: 'btn ghost', textContent: cancelLabel });
  const ok = el('button', { className: `btn ${tone}`, textContent: okLabel });
  const text = el('p', {}, ...(typeof body === 'string' ? [body] : body));
  const dlg = el('dialog', {}, el('div', { className: 'dialog-body' }, el('h2', { textContent: title }), text, el('div', { className: 'actions' }, el('span', { className: 'grow' }), cancel, ok)));
  cancel.addEventListener('click', () => dlg.close());
  ok.addEventListener('click', () => dlg.close('ok'));
  document.body.append(dlg);
  const closed = openDialog(dlg);
  (initialFocus === 'ok' ? ok : cancel).focus();
  return closed.then((value) => {
    dlg.remove(); // nothing is left behind, however many times it is opened
    return value === 'ok';
  });
}

// Always resolves, never rejects: true only for OK; Esc and Cancel give false.
// One at a time: a second call made while one is open waits for it to close (showModal() on an open dialog would throw).
let last: Promise<boolean> | null = null;
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  const mine = last === null ? present(opts) : last.then(() => present(opts));
  last = mine;
  void mine.then(() => { if (last === mine) last = null; });
  return mine;
}
