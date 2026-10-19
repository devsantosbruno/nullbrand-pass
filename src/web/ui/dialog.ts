import { el } from '../dom.js';

export function openDialog(dlg: HTMLDialogElement): Promise<string> {
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
}

export interface ConfirmOptions {
  title: string;
  body: string | readonly (string | HTMLElement)[];
  okLabel: string;
  cancelLabel: string;
  tone?: 'primary' | 'danger';
  initialFocus?: 'cancel' | 'ok';
}

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
    dlg.remove();
    return value === 'ok';
  });
}

let last: Promise<boolean> | null = null;
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  const mine = last === null ? present(opts) : last.then(() => present(opts));
  last = mine;
  void mine.then(() => { if (last === mine) last = null; });
  return mine;
}
