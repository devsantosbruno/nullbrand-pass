// nullbrand front-end. Vanilla TypeScript, no dependencies. This file only composes: it boots the page, switches the language, and
// wires the features of features/ together (each gets what it needs from the others as parameters, never by importing them).
// User data is always inserted with textContent (never innerHTML).
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

// Before anything can be shown or focused: every masked input gets its autofill/IME attributes (S6), and the static icons are drawn.
applySecretInputs(document);
applyIcons(document);
setSessionScreenHandler(showScreen);

// ---------- Language ----------
// Switches without reloading: static text via data-i18n attributes, dynamic parts re-rendered.
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
// The status decides which screen comes first. If its answer is not valid there is no screen to keep, and none is guessed: the
// "no session" screen shows the error with a button to try again (only on click, never by itself).
function showBootError(): void {
  showScreen('nosession');
  $('#nosession-info').hidden = true;
  $('#nosession-fail').hidden = false;
}
async function boot(): Promise<void> {
  await loadDicts();
  // Until the server answers, follow the browser. The server's answer wins when the choice is explicit.
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

// If the lists do not come back valid, nothing is rendered from them: the screen that was showing comes back (with the error visible
// there, by the caller) instead of an empty vault that would look like the real one. Before the first screen there is none to go
// back to, so the error screen of the boot takes its place.
async function enterVault(): Promise<void> {
  const before = screenShowing();
  showScreen('vault');
  try {
    await refresh();
  } catch (ex) {
    // Any failure of the first load leaves the vault screen: the caller's error element is on the previous screen.
    // A 401/423 has already sent api() to nosession/unlock, which stays.
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
// Each one wires its own listeners. What a feature needs from another comes in here: as a handle, or as a thunk when the other is
// created later (a thunk is only called once the page is running).
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
