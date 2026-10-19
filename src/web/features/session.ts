// The three gates of the vault: create it (first run), unlock it, lock it. Also the check made when the tab comes back to the front.
import { guardOkResponse, guardStatusResponse } from '../api-guards.js';
import { $, $button, $input } from '../dom.js';
import { api, msgOf } from '../http.js';
import { t } from '../locale.js';
import { showDetail, showScreen } from '../shell.js';
import { state } from '../state.js';
import { toast, toastIfInvalidResponse } from '../toast.js';
import { withBusy } from '../ui/busy.js';
import { paintMeter } from '../ui/meter.js';

export interface SessionDeps {
  // Shows the vault screen and loads its lists; throws if they do not come back valid.
  enterVault(): Promise<void>;
}

export function initSession({ enterVault }: SessionDeps): void {
  const setupPass = $input('#setup-pass');
  setupPass.addEventListener('input', () => paintMeter($('#setup-meter'), setupPass.value));
  // No <form> on these screens: without a form submission the browser has nothing to offer to save.
  const onEnterOrClick = (root: HTMLElement, btn: HTMLButtonElement, run: () => Promise<void>): void => {
    btn.addEventListener('click', () => { void run(); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !btn.disabled) { e.preventDefault(); void run(); } });
  };
  onEnterOrClick($('#form-setup'), $button('#setup-btn'), async () => {
    const p1 = setupPass.value;
    const p2 = $input('#setup-pass2').value;
    const err = $('#setup-error');
    if (p1 !== p2) { err.textContent = t('setup.mismatch'); return; }
    if (p1.length < 8) { err.textContent = t('setup.short'); return; }
    try {
      await withBusy($button('#setup-btn'), t('setup.creating'), () => t('setup.submit'), async () => {
        await api('POST /api/setup', { guard: guardOkResponse, body: { password: p1 } });
        setupPass.value = '';
        $input('#setup-pass2').value = '';
        await enterVault();
        toast(t('setup.created'));
      });
    } catch (ex) {
      err.textContent = msgOf(ex);
    }
  });

  onEnterOrClick($('#form-unlock'), $button('#unlock-btn'), async () => {
    const err = $('#unlock-error');
    err.textContent = '';
    try {
      await withBusy($button('#unlock-btn'), t('unlock.unlocking'), () => t('unlock.submit'), async () => {
        await api('POST /api/unlock', { guard: guardOkResponse, body: { password: $input('#unlock-pass').value } });
        $input('#unlock-pass').value = '';
        await enterVault();
      });
    } catch (ex) {
      err.textContent = msgOf(ex);
      $input('#unlock-pass').select();
    }
  });

  $('#btn-lock').addEventListener('click', async () => {
    try {
      await api('POST /api/lock', { guard: guardOkResponse });
    } catch (ex) {
      toastIfInvalidResponse(ex);
      return;
    }
    state.items = [];
    state.selection.clear();
    state.folders = [];
    state.selectedId = null;
    state.current = null;
    showDetail(null);
    // The session survives a lock: go back to the unlock screen.
    try {
      const st = await api('GET /api/status', { guard: guardStatusResponse });
      state.status = st;
      $('#unlock-path').textContent = st.vaultPath;
    } catch {}
    showScreen('unlock');
  });

  // Auto-lock: the server locks; here we only check when returning to the tab.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || $('#screen-vault').hidden) return;
    try {
      const s = await api('GET /api/status', { guard: guardStatusResponse });
      if (!s.unlocked) showScreen('unlock');
    } catch {}
  });
}
