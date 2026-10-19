// The sidebar's security menu and what it opens: change the master password, quit, delete the vault.
import { guardOkResponse, guardShutdownAck } from '../api-guards.js';
import { $, $button, $dialog, $input, el, query } from '../dom.js';
import { api, msgOf } from '../http.js';
import { rich, setRich, t } from '../locale.js';
import { showScreen } from '../shell.js';
import { state } from '../state.js';
import { toast } from '../toast.js';
import { confirm } from '../ui/dialog.js';
import { createMenu } from '../ui/menu.js';
import { statusLine } from '../ui/status-line.js';

/** Wires the security menu and its dialogs. */
export function initSecurity(): void {
  const dlgPassword = $dialog('#dlg-password');
  const dlgDestroy = $dialog('#dlg-destroy');
  const pwMsg = statusLine($('#pw-msg'));
  const secBtn = $button('#btn-security');
  const secItems = $('#security-items');
  const placeSecMenu = (): void => {
    // The body uses CSS zoom, which scales position:fixed coordinates.
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const r = secBtn.getBoundingClientRect();
    secItems.style.left = `${(r.right + 4) / z}px`;
    secItems.style.top = 'auto';
    secItems.style.bottom = `${(window.innerHeight - r.bottom) / z}px`;
  };
  // Esc is deliberately not stopped, so it still reaches the page.
  const secMenu = createMenu({ trigger: secBtn, menu: secItems, itemSelector: '[role=menuitem]', place: placeSecMenu, onResize: 'place', keyScope: $('#security-menu'), stopEscape: false });
  secItems.addEventListener('click', (e) => { if (e.target instanceof HTMLAnchorElement) secMenu.close(); });
  $('#btn-open-pw').addEventListener('click', () => { secMenu.close(); pwMsg(''); dlgPassword.showModal(); });
  $('#btn-pw-close').addEventListener('click', () => dlgPassword.close());
  $('#btn-open-shutdown').addEventListener('click', async () => {
    secMenu.close();
    if (!await confirm({ title: t('quit.title'), body: rich(t('quit.body')), okLabel: t('quit.confirm'), cancelLabel: t('common.cancel') })) return;
    await api('POST /api/shutdown', { guard: guardShutdownAck }).catch(() => {});
    document.body.replaceChildren(el('main', { className: 'screen center' },
      el('div', { className: 'card auth' }, el('h1', { textContent: t('quit.doneTitle') }),
        el('p', { className: 'muted' }))));
    setRich(query(document, 'main p', HTMLElement), 'quit.doneBody', 'npx nullbrand');
  });
  $('#btn-open-destroy').addEventListener('click', () => {
    secMenu.close();
    setRich($('#destroy-text'), 'destroy.body', state.status?.vaultPath || '');
    $input('#destroy-confirm').value = '';
    $('#destroy-msg').textContent = '';
    $button('#btn-destroy').disabled = true;
    dlgDestroy.showModal();
  });
  $('#btn-destroy-cancel').addEventListener('click', () => dlgDestroy.close());
  const destroyConfirm = $input('#destroy-confirm');
  destroyConfirm.addEventListener('input', () => { $button('#btn-destroy').disabled = !destroyConfirm.value; });
  $('#btn-destroy').addEventListener('click', async () => {
    try {
      await api('POST /api/destroy', { guard: guardOkResponse, body: { password: destroyConfirm.value } });
    } catch (ex) {
      $('#destroy-msg').textContent = msgOf(ex);
      return;
    }
    dlgDestroy.close();
    state.items = [];
    state.selection.clear();
    state.folders = [];
    const st = state.status;
    if (st !== null) state.status = { ...st, exists: false, unlocked: false };
    showScreen('setup');
    toast(t('destroy.doneHint'), 9000);
  });

  $('#btn-change-pw').addEventListener('click', async () => {
    const next = $input('#pw-next').value;
    if (next.length < 8) return pwMsg(t('pw.short'));
    pwMsg(t('pw.changing'), true);
    try {
      await api('POST /api/password', { guard: guardOkResponse, body: { current: $input('#pw-current').value, next } });
      $input('#pw-current').value = '';
      $input('#pw-next').value = '';
      pwMsg(t('pw.done'), true);
    } catch (ex) {
      pwMsg(msgOf(ex));
    }
  });
}
