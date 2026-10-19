// nullbrand front-end: vanilla TypeScript, no dependencies. This file only composes: it boots the page, switches the language and wires
// the features together, each receiving what it needs from the others as parameters rather than imports.
// User data always goes in through textContent, never innerHTML.
import { resolveLang, normalizeLang } from './i18n.js';
import type { Lang } from './i18n.js';
import type { StatusResponse } from './api.js';
import { guardConfigResponse, guardFolderList, guardPublicItems, guardStatusResponse } from './api-guards.js';
import { $, $button, data, expectInstance } from './dom.js';
import { ApiError, ApiResponseError, api, setSessionScreenHandler } from './http.js';
import { applyI18n, loadDicts, setLocale } from './locale.js';
import { screenShowing, showScreen } from './shell.js';
import { state } from './state.js';
import { toastError } from './toast.js';
import { initEditor } from './features/editor.js';
import { initFolders } from './features/folders.js';
import { initGenerator } from './features/generator.js';
import { initImportExport } from './features/import-export.js';
import { initLayout } from './features/layout.js';
import { initList } from './features/list.js';
import { initSecurity } from './features/security.js';
import { initSession } from './features/session.js';
import { initSshEditor } from './features/ssh-editor.js';
import { initViewer } from './features/viewer.js';
import { applyIcons } from './ui/icons.js';
import { applySecretInputs } from './ui/secret-input.js';

// Runs before anything is shown or focused: masked inputs get their autofill/IME attributes and the static icons are drawn.
applySecretInputs(document);
applyIcons(document);
setSessionScreenHandler(showScreen);

// ---------- Language ----------
/** Switches the language without reloading: static text through `data-i18n`, dynamic parts re-rendered. `persist` also saves the choice on the server. */
function setLang(next: Lang, { persist = false }: { persist?: boolean } = {}): void {
  if (!normalizeLang(next)) return;
  setLocale(next);
  applyI18n();
  editor.repaint();
  folders.repaint();
  if (!$('#screen-vault').hidden) {
    folders.renderSidebar();
    list.renderList();
    if (!$('#detail-view').hidden && state.current) viewer.renderView();
    generator.repaint();
  }
  if (persist) {
    api('PUT /api/config', { guard: guardConfigResponse, body: { lang: next } }).catch(() => {});
  }
}
document.addEventListener('click', (e) => {
  const target = e.target;
  const b = target instanceof Element ? target.closest('.lang-switch [data-lang]') : null;
  if (b) {
    const code = normalizeLang(data(expectInstance(b, HTMLElement, '.lang-switch [data-lang]'), 'lang'));
    if (code) setLang(code, { persist: true });
  }
});

// ---------- Boot ----------
// If the status answer is invalid no screen is guessed: the "no session" screen shows the error with a retry button (click only, never automatic).
function showBootError(): void {
  showScreen('nosession');
  $('#nosession-info').hidden = true;
  $('#nosession-fail').hidden = false;
}
// The status decides which screen comes first.
async function boot(): Promise<void> {
  await loadDicts();
  // Follow the browser until the server answers; the server wins when the choice is explicit.
  setLang(resolveLang({ system: navigator.language }).lang, { persist: false });
  let status: StatusResponse;
  try {
    status = await api('GET /api/status', { guard: guardStatusResponse });
    state.status = status;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return showScreen('nosession');
    if (err instanceof ApiResponseError) return showBootError();
    throw err;
  }
  const explicit = ['flag', 'env', 'config'].includes(status.langSource);
  setLang(explicit ? status.lang : resolveLang({ system: navigator.language }).lang, { persist: false });
  if (!status.exists) return showScreen('setup');
  if (!status.unlocked) {
    $('#unlock-path').textContent = status.vaultPath;
    return showScreen('unlock');
  }
  await enterVault();
}
$button('#nosession-retry').addEventListener('click', async (e) => {
  const btn = expectInstance(e.currentTarget, HTMLButtonElement, '#nosession-retry');
  btn.disabled = true;
  try {
    await boot();
  } catch (err) {
    toastError(err);
  } finally {
    btn.disabled = false;
  }
});

// If the lists come back invalid nothing is rendered from them: the previous screen returns, with the error shown by the caller, instead of an
// empty vault that would look real. With no previous screen the boot error screen takes its place.
async function enterVault(): Promise<void> {
  const before = screenShowing();
  showScreen('vault');
  try {
    await refresh();
  } catch (ex) {
    // The caller's error element is on the previous screen. A 401/423 has already sent api() to nosession/unlock, which stays.
    if (screenShowing() === 'vault') {
      if (before === null) showBootError();
      else showScreen(before);
    }
    throw ex;
  }
}

async function refresh(): Promise<void> {
  [state.items, state.folders] = await Promise.all([
    api('GET /api/items', { guard: guardPublicItems }),
    api('GET /api/folders', { guard: guardFolderList }),
  ]);
  folders.renderSidebar();
  list.renderList();
}

// ---------- Features ----------
// Each feature wires its own listeners. What it needs from another arrives as a handle, or as a thunk when the other is created later.
initLayout();
initSession({ enterVault });
const folders = initFolders({ renderList: () => list.renderList(), refresh });
const list = initList({ select: (id) => viewer.select(id), promptNewFolder: () => folders.promptNew(), refresh });
const viewer = initViewer({ renderList: () => list.renderList(), refresh });
const ssh = initSshEditor();
const generator = initGenerator();
const editor = initEditor({ folders, generator, ssh, select: (id) => viewer.select(id), renderView: () => viewer.renderView(), renderList: () => list.renderList(), refresh });
initImportExport({ refresh });
initSecurity();

boot().catch(toastError);
