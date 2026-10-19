// nullbrand front-end. Vanilla TypeScript, no dependencies.
// User data is always inserted with textContent (never innerHTML).
import { resolveLang, normalizeLang } from './i18n.js';
import type { Lang } from './i18n.js';
import type { PublicItem, StatusResponse } from './api.js';
import {
  guardConfigResponse,
  guardCountResponse,
  guardFolderDeleteResponse,
  guardFolderList,
  guardFolderNameResponse,
  guardOkResponse,
  guardPublicItems,
  guardSshKeyResponse,
  guardStatusResponse,
  guardVaultItem,
} from './api-guards.js';






import { api, ApiError, ApiResponseError, msgOf, setSessionScreenHandler } from './http.js';

import { applyI18n, fmtDate, fmtRelativeTime, loadDicts, lc, rich, setLocale, t } from './locale.js';
import { toast, toastError, toastIfInvalidResponse } from './toast.js';
import { copy } from './clipboard.js';
import { initGenerator } from './features/generator.js';
import { initImportExport } from './features/import-export.js';
import { initLayout } from './features/layout.js';
import { initSecurity } from './features/security.js';
import { initSession } from './features/session.js';
import { paintMeter } from './ui/meter.js';
import { screenShowing, showDetail, showScreen } from './shell.js';
import { isItemType } from './vault-types.js';
import type { IdentityKey, ItemType, VaultItem } from './vault-types.js';
import { $, $button, $dialog, $form, $input, $textarea, DomValueError, at, data, dataOneOf, el, expectInstance, firstFile, oneOf, query, queryAll, textOf, tx } from './dom.js';
import { currentItem, state } from './state.js';
import { strengthLevel } from './ui/strength.js';
import { hostOf, isHttpUrl, normalizeUrl, siteDomain } from './ui/url.js';


import { applySecretInputs, isMasked, setMasked } from './ui/secret-input.js';
import { createRevealToggle } from './ui/reveal-toggle.js';
import type { RevealToggle } from './ui/reveal-toggle.js';
import { confirm, openDialog } from './ui/dialog.js';
import { createMenu, flipUp } from './ui/menu.js';
import { digits, fmtCardExpiry, fmtCardNumber, maskDate, maskDigits, maskPhone } from './ui/masks.js';
import { FIELD_VALIDATORS } from './ui/validators.js';
import type { ValidatedField } from './ui/validators.js';
import { applyIcons, icon, iconNameOf } from './ui/icons.js';
import type { IconName } from './ui/icons.js';

// Before anything can be shown or focused: every masked input gets its autofill/IME attributes (S6).
applySecretInputs(document);
applyIcons(document);
setSessionScreenHandler(showScreen);

// ---------- Language ----------
// Switches without reloading: static text via data-i18n attributes, dynamic parts re-rendered.
function setLang(next: Lang, { persist = false }: { persist?: boolean } = {}): void {
  if (!normalizeLang(next)) return;
  setLocale(next);
  applyI18n();
  paintSectionTitles();
  paintEditTitle(state.editing);
  for (const toggle of revealToggles) toggle.repaint();
  setFolderValue(folderInput.value);
  if (!$('#screen-vault').hidden) {
    renderSidebar();
    renderList();
    if (!$('#detail-view').hidden && state.current) renderView();
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
  renderSidebar();
  renderList();
}

// ---------- Session ----------
initSession({ enterVault });

initLayout();

// ---------- Sidebar ----------
function folders(): string[] {
  return state.folders;
}

// ---------- Folder select ----------
const folderSelect = $('#folder-select');
const folderInput = query(folderSelect, 'input[name="folder"]', HTMLInputElement);
const folderTrigger = query(folderSelect, '.select-trigger', HTMLButtonElement);
const folderMenu = query(folderSelect, '.select-menu', HTMLElement);

function setFolderValue(v: string): void {
  folderInput.value = v;
  const label = query(folderSelect, '.select-value', HTMLElement);
  label.textContent = v || t('folder.none');
  label.classList.toggle('placeholder', !v);
}

function renderFolderSelect(): void {
  const opt = (label: string, value: string): HTMLButtonElement => {
    const b = el('button', { type: 'button', className: 'select-item', role: 'option', textContent: label });
    b.setAttribute('aria-selected', String(folderInput.value === value));
    b.addEventListener('click', () => {
      folderMenuHandle.close();
      setFolderValue(value);
      folderTrigger.focus();
    });
    return b;
  };
  const none = opt(t('folder.none'), '');
  const list = folders();
  if (list.length) none.classList.add('sep');
  folderMenu.replaceChildren(...list.map((f) => opt(f, f)), none);
}

const folderMenuHandle = createMenu({
  trigger: folderTrigger,
  menu: folderMenu,
  itemSelector: '.select-item',
  onOpen: renderFolderSelect,
  place: flipUp,
  onResize: 'close',
  initialFocus: () => folderMenu.querySelector('[aria-selected="true"]') || folderMenu.firstElementChild,
});

function renderSidebar(): void {
  $('#count-all').textContent = String(state.items.length);
  for (const b of queryAll(document, '.filter', HTMLElement)) b.classList.toggle('active', !state.folder && b.dataset['filter'] === state.filter);
  const nav = $('#folders');
  nav.replaceChildren();
  const list = folders();
  if (list.length === 0) nav.append(el('p', { className: 'muted small', textContent: t('folders.none'), style: 'margin:4px 10px' }));
  for (const f of list) {
    const n = state.items.filter((i) => i.folder === f).length;
    const btn = el('button', { className: `folder${state.folder === f ? ' active' : ''}`, title: f }, el('span', { className: 'lbl' }, el('span', { className: 'fcount', textContent: n }), el('span', { className: 't', textContent: f })));
    btn.addEventListener('click', () => { state.folder = f; state.filter = 'all'; renderSidebar(); renderList(); });
    const edit = el('button', { className: 'folder-edit', type: 'button', title: t('folder.editAria', { name: f }) }, icon('pen', { size: 14, strokeWidth: 2 }));
    edit.setAttribute('aria-label', t('folder.editAria', { name: f }));
    edit.addEventListener('click', () => editFolder(f));
    nav.append(el('div', { className: 'folder-row' }, btn, edit));
  }
  renderFolderSelect();
}

const dlgFolder = $dialog('#dlg-folder');
const folderName = $input('#folder-name');
const folderExists = (name: string): string | undefined => folders().find((f) => f.toLowerCase() === name.toLowerCase());

// Opens the new-folder modal; resolves with the name (existing or new) or null if cancelled
function promptNewFolder(): Promise<string | null> {
  folderName.value = '';
  $('#folder-msg').textContent = '';
  $button('#btn-folder-create').disabled = true;
  const closed = openDialog(dlgFolder);
  folderName.focus();
  return closed.then((answer) => {
    const name = folderName.value.trim().slice(0, 200);
    if (answer !== 'ok' || !name) return null;
    return api('POST /api/folders', { guard: guardFolderNameResponse, body: { name } })
      .then(async (r) => { state.folders = await api('GET /api/folders', { guard: guardFolderList }); return r.name; })
      .catch((ex: unknown) => { toastError(ex); return null; });
  });
}
folderName.addEventListener('input', () => {
  const name = folderName.value.trim();
  $button('#btn-folder-create').disabled = !name;
  $('#folder-msg').textContent = name && folderExists(name) ? t('folder.exists') : '';
});
$form('#form-folder').addEventListener('submit', (e) => {
  e.preventDefault();
  if (folderName.value.trim()) dlgFolder.close('ok');
});
$('#btn-folder-cancel').addEventListener('click', () => dlgFolder.close());

// ---------- Edit / delete folder ----------
const dlgFolderEdit = $dialog('#dlg-folder-edit');
const folderEditName = $input('#folder-edit-name');
const folderDeletePanel = $('#folder-delete-panel');
let editingFolder: string | null = null;
let confirmingDelete = false;
// The folder being edited, for the places that need its name. The dialog only opens through editFolder().
function editedFolder(): string {
  if (editingFolder === null) throw new DomValueError('no folder is being edited');
  return editingFolder;
}

function setConfirmingDelete(on: boolean): void {
  confirmingDelete = on;
  folderDeletePanel.hidden = !on;
  folderEditName.disabled = on;
  $('#btn-folder-save').hidden = on;
  $('#btn-folder-delete').textContent = t(on ? 'folder.confirmDelete' : 'folder.delete');
}

function editFolder(name: string): void {
  editingFolder = name;
  const n = state.items.filter((i) => i.folder === name).length;
  folderEditName.value = name;
  $('#folder-edit-msg').textContent = '';
  $button('#btn-folder-save').disabled = true;
  $('#folder-delete-text').textContent = n ? t('folder.deleteText', { name, count: n }) : t('folder.deleteEmpty', { name });
  $('#folder-delete-items-row').hidden = n === 0;
  $input('#folder-delete-items').checked = false;
  $('#folder-delete-items-label').textContent = t('folder.alsoDelete', { count: n });
  setConfirmingDelete(false);
  dlgFolderEdit.showModal();
  folderEditName.focus();
  folderEditName.select();
}

folderEditName.addEventListener('input', () => {
  const name = folderEditName.value.trim();
  const other = name && folderExists(name);
  $button('#btn-folder-save').disabled = !name || name === editingFolder;
  $('#folder-edit-msg').textContent = other && other.toLowerCase() !== editedFolder().toLowerCase()
    ? t('folder.mergeNote') : '';
});

$form('#form-folder-edit').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($button('#btn-folder-save').disabled || confirmingDelete) return;
  try {
    const { name } = await api('PUT /api/folders', { guard: guardFolderNameResponse, body: { from: editedFolder(), to: folderEditName.value } });
    if (state.folder === editingFolder) state.folder = name;
    dlgFolderEdit.close();
    await refresh();
    toast(t('folder.renamed'));
  } catch (ex) {
    $('#folder-edit-msg').textContent = msgOf(ex);
  }
});

$('#btn-folder-delete').addEventListener('click', async () => {
  if (!confirmingDelete) return setConfirmingDelete(true);
  try {
    await api('POST /api/folders/delete', { guard: guardFolderDeleteResponse, body: { name: editedFolder(), deleteItems: $input('#folder-delete-items').checked } });
    if (state.folder === editingFolder) state.folder = null;
    state.selection.clear();
    dlgFolderEdit.close();
    await refresh();
    if (state.selectedId && !state.items.some((i) => i.id === state.selectedId)) { state.selectedId = null; state.current = null; showDetail(null); }
    toast(t('folder.deleted'));
  } catch (ex) {
    toastError(ex);
  }
});

$('#btn-folder-edit-cancel').addEventListener('click', () => {
  if (confirmingDelete) setConfirmingDelete(false);
  else dlgFolderEdit.close();
});

$('#btn-new-folder-edit').addEventListener('click', async () => {
  const name = await promptNewFolder();
  if (!name) return;
  setFolderValue(name);
  renderSidebar();
});

$('#btn-new-folder').addEventListener('click', async () => {
  const name = await promptNewFolder();
  if (!name) return;
  state.folder = name;
  state.filter = 'all';
  renderSidebar();
  renderList();
});

$('#filters').addEventListener('click', (e) => {
  const target = e.target;
  const b = target instanceof Element ? target.closest('.filter') : null;
  if (!b) return;
  state.filter = data(expectInstance(b, HTMLElement, '.filter'), 'filter');
  state.folder = null;
  renderSidebar();
  renderList();
});

// ---------- List ----------
function visibleItems(): PublicItem[] {
  const q = state.query.trim().toLowerCase();
  return state.items.filter((i) => {
    if (state.folder && i.folder !== state.folder) return false;
    if (state.filter === 'favorite' && !i.favorite) return false;
    if ((state.filter === 'login' || state.filter === 'note' || state.filter === 'card' || state.filter === 'identity' || state.filter === 'ssh') && i.type !== state.filter) return false;
    if (!q) return true;
    return [i.name, i.username, i.folder, i.fullName, i.email, i.sshHost, i.sshUser, i.sshTitle, ...i.uris].some((v) => v && v.toLowerCase().includes(q));
  });
}

function renderList(): void {
  const items = visibleItems();
  const ul = $('#item-list');
  ul.replaceChildren(
    ...items.map((i) => {
      const sub = i.type === 'note' ? t('type.note') : i.type === 'ssh' ? (i.sshHost ? `${i.sshUser ? i.sshUser + '@' : ''}${i.sshHost}` : i.sshFingerprint || t('type.ssh')) : i.type === 'identity' ? i.fullName || i.email || t('type.identity') : i.type === 'card' ? (i.cardNumber ? `•••• ${i.cardNumber.replace(/\D/g, '').slice(-4)}` : t('type.card')) : i.username || (i.uris[0] ? hostOf(i.uris[0]) : '—');
      const check = el('input', { type: 'checkbox', className: 'check', checked: state.selection.has(i.id) });
      check.setAttribute('aria-label', t('sel.itemAria', { name: i.name }));
      check.addEventListener('click', (e) => e.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) state.selection.add(i.id); else state.selection.delete(i.id);
        li.classList.toggle('checked', check.checked);
        renderSelectionBar();
      });
      const typeIcon = TYPE_ICONS[i.type];
      const li = el(
        'li',
        { className: `item${i.id === state.selectedId ? ' active' : ''}${state.selection.has(i.id) ? ' checked' : ''}`, tabIndex: 0 },
        check,
        el('div', { className: `avatar avatar-${i.type}`, textContent: typeIcon ? '' : (i.name || '?').trim()[0] || '?' }, typeIcon ? icon(typeIcon) : null),
        el('div', { className: 'meta' }, el('div', { className: 'name', textContent: i.name }), el('div', { className: 'sub', textContent: sub })),
        i.favorite ? el('span', { className: 'star', textContent: '★', title: t('item.favorite') }) : null
      );
      li.addEventListener('click', () => select(i.id));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(i.id); });
      return li;
    })
  );
  $('#empty-list').hidden = items.length > 0;
  renderSelectionBar();
}

// ---------- Bulk selection ----------
const selBar = $('#sel-bar');
const selMenu = $('#sel-menu');
const selFolderBtn = $button('#sel-folder');

function renderSelectionBar(): void {
  const ids = new Set(state.items.map((i) => i.id));
  for (const id of state.selection) if (!ids.has(id)) state.selection.delete(id);
  const n = state.selection.size;
  selBar.hidden = n === 0;
  if (n === 0) { selMenuHandle.close(); return; }
  $('#sel-count').textContent = t('sel.count', { count: n });
  const vis = visibleItems();
  const inVis = vis.filter((i) => state.selection.has(i.id)).length;
  const all = $input('#sel-all');
  all.checked = vis.length > 0 && inVis === vis.length;
  all.indeterminate = inVis > 0 && inVis < vis.length;
}

function clearSelection(): void {
  state.selection.clear();
  renderList();
}

const selAll = $input('#sel-all');
selAll.addEventListener('change', () => {
  for (const i of visibleItems()) selAll.checked ? state.selection.add(i.id) : state.selection.delete(i.id);
  renderList();
});
$('#sel-cancel').addEventListener('click', clearSelection);

async function moveSelection(folder: string): Promise<void> {
  const ids = [...state.selection];
  selMenuHandle.close();
  try {
    await api('POST /api/items/bulk', { guard: guardCountResponse, body: { action: 'move', ids, folder } });
    state.selection.clear();
    await refresh();
    toast(folder ? t('move.done', { count: ids.length, folder }) : t('move.removed'));
  } catch (ex) { toastError(ex); }
}

// The items are built each time it opens: they follow the folders as they are then.
function renderSelMenu(): void {
  const opt = (label: string, onClick: () => void | Promise<void>, extra: { sep?: boolean; count?: number } = {}): HTMLButtonElement => {
    const b = el('button', { type: 'button', className: `select-item${extra.sep ? ' sep' : ''}` }, el('span', { textContent: label }), extra.count != null ? el('span', { className: 'n', textContent: extra.count }) : null);
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', onClick);
    return b;
  };
  selMenu.replaceChildren(
    ...folders().map((f) => opt(f, () => moveSelection(f), { count: state.items.filter((i) => i.folder === f).length })),
    opt(t('folder.newEllipsis'), async () => {
      const name = await promptNewFolder();
      if (name) moveSelection(name); else selMenuHandle.close();
    }, { sep: folders().length > 0 }),
    opt(t('folder.none'), () => moveSelection(''))
  );
}
const selMenuHandle = createMenu({ trigger: selFolderBtn, menu: selMenu, itemSelector: '.select-item', onOpen: renderSelMenu });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selection.size && !selMenuHandle.isOpen && !document.querySelector('dialog[open]')) clearSelection();
});

// Delete confirmation modal (replaces the native confirm())
const confirmDelete = (title: string, text: string, label: string): Promise<boolean> =>
  confirm({ title, body: text, okLabel: label, cancelLabel: t('common.cancel'), tone: 'danger' });

$('#sel-delete').addEventListener('click', async () => {
  const ids = [...state.selection];
  const n = ids.length;
  if (!await confirmDelete(
    t('delete.title', { count: n }),
    t('delete.undone'),
    t('delete.button', { count: n }),
  )) return;
  try {
    await api('POST /api/items/bulk', { guard: guardCountResponse, body: { action: 'delete', ids } });
    state.selection.clear();
    if (state.selectedId !== null && ids.includes(state.selectedId)) { state.selectedId = null; state.current = null; showDetail(null); }
    await refresh();
    toast(t('delete.done', { count: n }));
  } catch (ex) { toastError(ex); }
});

const searchInput = $input('#search');
searchInput.addEventListener('input', () => { state.query = searchInput.value; renderList(); });

// ---------- Detail ----------
// If the item does not come back valid, nothing is shown from it: the previous selection and detail stay as they were.
async function select(id: string): Promise<void> {
  const previousId = state.selectedId;
  state.selectedId = id;
  renderList();
  try {
    state.current = await api('GET /api/items/:id', { guard: guardVaultItem, path: `/api/items/${encodeURIComponent(id)}` });
  } catch (ex) {
    if (!(ex instanceof ApiResponseError)) throw ex;
    state.selectedId = previousId;
    renderList();
    toastError(ex);
    return;
  }
  renderView();
}

const TYPE_ICONS: Readonly<Partial<Record<ItemType, IconName>>> = { note: 'pencil', card: 'card', identity: 'id', ssh: 'key-down' };
const iconBtn = (name: IconName, label: string, className = 'dv-icon-btn'): HTMLButtonElement => {
  const b = el('button', { className, type: 'button' });
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  return b;
};

// Reusable field row for the detail pane.
// kind: 'text' | 'password' | 'site'. The real password only enters the DOM when shown.
interface FieldRowOptions {
  kind?: 'text' | 'password' | 'site';
  meter?: boolean;
  pre?: boolean;
  copyable?: boolean;
}
function FieldRow(label: string, value: string, { kind = 'text', meter = true, pre = false, copyable = false }: FieldRowOptions = {}): HTMLElement {
  const valueEl = el('div', { className: pre ? 'frow-value pre' : 'frow-value' });
  const body = el('div', { className: 'frow-body' }, el('div', { className: 'frow-label', textContent: label }), valueEl);
  const actions = el('div', { className: 'frow-actions' });
  const row = el('div', { className: 'frow' }, body, actions);

  if (kind === 'password') {
    let shown = false;
    const { level, active } = strengthLevel(value);
    const strengthEl = el('div', { className: `frow-strength ${level === 'strong' ? 'ok' : level === 'medium' ? 'warn' : 'err'}` });
    const segs = el('div', { className: 'frow-segs' });
    for (let n = 0; n < 4; n++) segs.append(el('span', { className: n < active ? 'on' : '' }));
    strengthEl.append(segs, el('span', { className: 'frow-strength-text', textContent: t('strength.line', { level: t(`strength.${level}`), count: [...value].length }) }));
    const toggle = iconBtn('eye', t('password.show'));
    const paint = (): void => {
      valueEl.textContent = shown ? value : '•'.repeat(Math.min(12, Math.max(8, [...value].length)));
      valueEl.classList.toggle('pre', pre && shown);
      valueEl.classList.toggle('dots', !shown);
      toggle.replaceChildren(icon(shown ? 'eye-off' : 'eye'));
      toggle.setAttribute('aria-label', t(shown ? 'password.hide' : 'password.show'));
    };
    toggle.addEventListener('click', () => { shown = !shown; paint(); });
    paint();
    if (meter) body.append(strengthEl);
    actions.append(toggle);
  } else if (kind === 'site') {
    if (isHttpUrl(value)) {
      const href = normalizeUrl(value);
      valueEl.append(el('a', { href, textContent: siteDomain(value), target: '_blank', rel: 'noopener noreferrer' }));
      const open = el('a', { className: 'dv-icon-btn', href, target: '_blank', rel: 'noopener noreferrer' });
      open.setAttribute('aria-label', t('aria.openSite'));
      open.append(icon('external'));
      actions.append(open);
    } else valueEl.textContent = value;
  } else valueEl.textContent = value;

  if (copyable) {
    const c = iconBtn('copy', t('aria.copy', { label: lc(label) }));
    c.addEventListener('click', () => copy(value, label, { sensitive: kind === 'password' }));
    actions.append(c);
  }
  return row;
}

function renderView(): void {
  const i = currentItem();
  $('#view-avatar').textContent = (i.name.trim().slice(0, 2) || '?').toLowerCase();
  const viewName = $('#view-name');
  viewName.textContent = i.name;
  viewName.title = i.name;
  const fav = $('#btn-fav');
  fav.setAttribute('aria-pressed', String(Boolean(i.favorite)));
  fav.setAttribute('aria-label', t(i.favorite ? 'fav.remove' : 'fav.add'));
  fav.replaceChildren(icon('star', { filled: Boolean(i.favorite) }));
  $('#view-chips').replaceChildren(
    el('span', { className: 'dv-chip', textContent: t(i.type === 'note' ? 'type.secureNote' : `type.${['card', 'identity', 'ssh'].includes(i.type) ? i.type : 'login'}`) }),
    ...(i.folder ? [el('span', { className: 'dv-chip', textContent: i.folder })] : [])
  );

  const rows: HTMLElement[] = [];
  if (i.type === 'login') {
    if (i.username) rows.push(FieldRow(t('field.usernameShort'), i.username, { copyable: true }));
    if (i.password) rows.push(FieldRow(t('field.password'), i.password, { kind: 'password', copyable: true }));
    i.uris.forEach((u, n) => rows.push(FieldRow(i.uris.length > 1 ? t('field.siteN', { n: n + 1 }) : t('field.site'), u, { kind: 'site', copyable: true })));
    if (i.totp) rows.push(FieldRow(t('field.totp'), i.totp, { kind: 'password', copyable: true }));
  }
  if (i.type === 'card') {
    if (i.cardholder) rows.push(FieldRow(t('field.cardholder'), i.cardholder, { copyable: true }));
    if (i.cardNumber) rows.push(FieldRow(t('field.cardNumber'), i.cardNumber, { kind: 'password', meter: false, copyable: true }));
    if (i.cardExpiry) rows.push(FieldRow(t('field.expiry'), i.cardExpiry, { copyable: true }));
    if (i.cardCvv) rows.push(FieldRow(t('field.cvv'), i.cardCvv, { kind: 'password', meter: false, copyable: true }));
  }
  if (i.type === 'identity') {
    IDENTITY_SECTIONS.forEach((sec) => {
      const secRows = sec.fields.filter((f) => i[f.key]).map((f) => FieldRow(t(f.label), i[f.key], { copyable: true }));
      if (!secRows.length) return;
      if (rows.length) rows.push(el('hr'));
      rows.push(el('div', { className: 'dv-section' }, icon(sec.icon), t(sec.title)), ...secRows);
    });
  }
  const sshDownload = $('#view-ssh-download');
  sshDownload.replaceChildren();
  if (i.type === 'ssh') {
    const keyRows: HTMLElement[] = [];
    if (i.sshAlgo) keyRows.push(FieldRow(t('field.algorithm'), SSH_ALGOS[i.sshAlgo] || i.sshAlgo));
    if (i.sshTitle) keyRows.push(FieldRow(t('ssh.title'), i.sshTitle, { copyable: true }));
    if (i.sshPublicKey) keyRows.push(FieldRow(t('ssh.public'), sshPubLine(i.sshPublicKey, i.sshTitle), { pre: true, copyable: true }));
    if (i.sshFingerprint) keyRows.push(FieldRow(t('ssh.fingerprint'), i.sshFingerprint, { copyable: true }));
    if (i.sshPrivateKey) keyRows.push(FieldRow(t('ssh.private'), i.sshPrivateKey, { kind: 'password', meter: false, pre: true, copyable: true }));
    const connRows: HTMLElement[] = [];
    if (i.sshHost) connRows.push(FieldRow(t('ssh.host'), i.sshHost, { copyable: true }));
    if (i.sshUser) connRows.push(FieldRow(t('ssh.user'), i.sshUser, { copyable: true }));
    if (i.sshPort) connRows.push(FieldRow(t('ssh.port'), i.sshPort, { copyable: true }));
    const cfg = sshConfig(i);
    const sections: readonly (readonly [IconName, string, HTMLElement[]])[] = [
      ['key', t('ssh.sectionKey'), keyRows],
      ['server', t('ssh.sectionConn'), connRows],
      ['file', t('ssh.configPreview'), [FieldRow(t('field.suggestedEntry'), cfg, { pre: true, copyable: true })]],
    ];
    sections.forEach(([ic, title, r]) => {
      if (!r.length) return;
      if (rows.length) rows.push(el('hr'));
      rows.push(el('div', { className: 'dv-section' }, icon(ic), ...rich(title)), ...r);
    });
    if (i.sshPrivateKey) {
      const dl = el('button', { type: 'button', className: 'btn primary' }, icon('download'), t('ssh.download'));
      dl.addEventListener('click', () => {
        downloadSshKeyPair({ name: i.name, algo: i.sshAlgo, privateKey: i.sshPrivateKey, publicKey: i.sshPublicKey && sshPubLine(i.sshPublicKey, i.sshTitle) });
        toast(t('ssh.downloaded'));
      });
      sshDownload.append(dl, el('p', {}, ...rich(t('ssh.afterExtract')), el('br'), el('code', { textContent: `chmod 600 ~/.ssh/${sshFileName(i.name, i.sshAlgo)}` })));
    }
  }
  sshDownload.hidden = !sshDownload.childElementCount;
  const fields = $('#view-fields');
  fields.hidden = rows.length === 0;
  fields.replaceChildren(...rows);

  const notes = $('#view-notes');
  notes.hidden = !i.notes;
  if (i.notes) {
    const cp = iconBtn('copy', t('aria.copy', { label: lc(t('field.notes')) }), 'dv-icon-btn small');
    cp.addEventListener('click', () => copy(i.notes, t('field.notes'), { sensitive: true }));
    notes.replaceChildren(
      el('div', { className: 'dv-notes-head' }, el('span', { className: 'frow-label', textContent: t('field.notes') }), cp),
      el('div', { className: 'dv-notes-body', textContent: i.notes })
    );
  } else notes.replaceChildren();

  const meta: HTMLElement[] = [];
  if (i.createdAt) meta.push(el('span', { textContent: t('meta.created', { date: fmtDate(i.createdAt) }) }));
  if (i.updatedAt) meta.push(el('span', { textContent: t('meta.edited', { when: fmtRelativeTime(i.updatedAt) }), title: fmtDate(i.updatedAt) }));
  $('#view-meta').replaceChildren(...meta);
  showDetail('view');
}

$('#btn-fav').addEventListener('click', async () => {
  const i = state.current;
  if (!i) return;
  try {
    const saved = await api('PUT /api/items/:id', { guard: guardVaultItem, body: { ...i, favorite: !i.favorite }, path: `/api/items/${encodeURIComponent(i.id)}` });
    await refresh();
    await select(saved.id);
  } catch (ex) { toastError(ex); }
});

$('#btn-back').addEventListener('click', () => { state.selectedId = null; renderList(); showDetail(null); });

// ---------- SSH key ----------
const SSH_ALGOS: Readonly<Record<string, string>> = { ed25519: 'Ed25519', rsa4096: 'RSA 4096' };
const sshPubLine = (pub: string, title: string): string => (title ? `${pub} ${title}` : pub);
const sshSlug = (v: string): string => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
const sshFileName = (name: string, algo: string): string => `id_${algo === 'rsa4096' ? 'rsa' : 'ed25519'}_${sshSlug(name)}`;
// Uncompressed ZIP, hand-written (no dependencies). The Unix mode goes in the external
// attributes so that `unzip` restores the private key with 600 right away.
const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = at(CRC_TABLE, (c ^ b) & 0xff) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
// [offset, value, size in bytes] of one little-endian field of a ZIP header.
type ZipField = readonly [number, number, number];
interface ZipFile {
  name: string;
  text: string;
  mode: number;
}
function zipStore(files: readonly ZipFile[]): Blob {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: (DataView<ArrayBuffer> | Uint8Array<ArrayBuffer>)[] = [];
  const central: (DataView<ArrayBuffer> | Uint8Array<ArrayBuffer>)[] = [];
  let offset = 0;
  for (const { name, text, mode } of files) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    const localFields: readonly ZipField[] = [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, dosTime, 2], [12, dosDate, 2], [14, crc, 4],
      [18, data.length, 4], [22, data.length, 4], [26, nameB.length, 2], [28, 0, 2]];
    localFields.forEach(([o, v, n]) => (n === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true)));
    const cen = new DataView(new ArrayBuffer(46));
    const centralFields: readonly ZipField[] = [[0, 0x02014b50, 4], [4, (3 << 8) | 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, dosTime, 2], [14, dosDate, 2],
      [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nameB.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2],
      [36, 0, 2], [38, ((0o100000 | mode) << 16) >>> 0, 4], [42, offset, 4]];
    centralFields.forEach(([o, v, n]) => (n === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
    parts.push(local, nameB, data);
    central.push(cen, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  const endFields: readonly ZipField[] = [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, offset, 4]];
  endFields.forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
// Downloads the key pair in a single .zip: private (600) and public (644).
function downloadSshKeyPair({ name, algo, privateKey, publicKey }: { name: string; algo: string; privateKey: string; publicKey: string }): void {
  const base = sshFileName(name, algo);
  const nl = (t: string): string => (t.endsWith('\n') ? t : `${t}\n`);
  const files: ZipFile[] = [{ name: base, text: nl(privateKey), mode: 0o600 }];
  if (publicKey) files.push({ name: `${base}.pub`, text: nl(publicKey), mode: 0o644 });
  const link = el('a', { href: URL.createObjectURL(zipStore(files)), download: `${base}.zip` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
// Suggested entry for ~/.ssh/config; the key file follows the ssh-keygen naming convention.
function sshConfig({ name = '', sshAlgo = 'ed25519', sshHost = '', sshUser = '', sshPort = '' }: { name?: string; sshAlgo?: string; sshHost?: string; sshUser?: string; sshPort?: string }): string {
  const alias = sshSlug(name);
  const file = `~/.ssh/${sshFileName(name, sshAlgo)}`;
  return [
    `Host ${alias}`,
    sshHost && `  HostName ${sshHost}`,
    sshUser && `  User ${sshUser}`,
    sshPort && sshPort !== '22' && `  Port ${sshPort}`,
    `  IdentityFile ${file}`,
    '  IdentitiesOnly yes',
  ].filter(Boolean).join('\n');
}

// ---------- Identity ----------
interface IdentityField {
  key: IdentityKey;
  label: string;
  max: number;
  type?: string;
  inputmode?: string;
  placeholder?: string;
  placeholderKey?: string;
  mono?: boolean;
  mask?: (v: string) => string;
  half?: boolean;
}
interface IdentitySection {
  title: string;
  icon: IconName;
  fields: IdentityField[];
}
const IDENTITY_SECTIONS: IdentitySection[] = [
  { title: 'identity.personal', icon: 'user', fields: [
    { key: 'fullName', label: 'field.fullName', max: 128, placeholder: 'Jane Doe' },
    { key: 'email', label: 'field.email', max: 254, type: 'email', inputmode: 'email', placeholder: 'jane@example.com' },
    { key: 'birthDate', label: 'field.birthDate', max: 10, mono: true, placeholderKey: 'placeholder.date', mask: maskDate, inputmode: 'numeric', half: true },
    { key: 'phone', label: 'field.phone', max: 15, mono: true, mask: maskPhone, type: 'tel', inputmode: 'tel', placeholder: '(12) 34567-8910', half: true },
  ] },
  { title: 'identity.documents', icon: 'id', fields: [
    { key: 'cpf', label: 'field.cpf', max: 14, mono: true, placeholder: '000.000.000-00', mask: maskDigits('###.###.###-##'), inputmode: 'numeric', half: true },
    { key: 'rg', label: 'field.rg', max: 32, mono: true, placeholder: '12.345.678-9', half: true },
    { key: 'cnh', label: 'field.cnh', max: 20, mono: true, placeholder: '12345678901', mask: digits(11), inputmode: 'numeric', half: true },
    { key: 'passport', label: 'field.passport', max: 20, mono: true, placeholder: 'AB123456', half: true },
    { key: 'pis', label: 'field.pis', max: 14, mono: true, placeholder: '000.00000.00-0', mask: maskDigits('###.#####.##-#'), inputmode: 'numeric', half: true },
    { key: 'cnpj', label: 'field.cnpj', max: 18, mono: true, placeholder: '00.000.000/0000-00', mask: maskDigits('##.###.###/####-##'), inputmode: 'numeric', half: true },
  ] },
  { title: 'identity.address', icon: 'pin', fields: [
    { key: 'address', label: 'field.address', max: 256, placeholder: '123 Main St, Apt 45' },
    { key: 'city', label: 'field.city', max: 128, placeholder: 'São Paulo', half: true },
    { key: 'state', label: 'field.state', max: 64, placeholder: 'SP', half: true },
    { key: 'zip', label: 'field.zip', max: 9, mono: true, placeholder: '00000-000', mask: maskDigits('#####-###'), inputmode: 'numeric', half: true },
    { key: 'country', label: 'field.country', max: 64, placeholder: 'Brazil', half: true },
  ] },
];
const IDENTITY_KEYS: IdentityKey[] = IDENTITY_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

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
buildIdentityForm();

function paintEditTitle(item: VaultItem | null = state.editing): void {
  $('#edit-title').textContent = t(item ? 'edit.titleEdit' : 'edit.titleNew');
}

// ---------- Edit ----------
const form = $form('#detail-edit');
// The controls of the form, by name (the identity ones were just built by buildIdentityForm).
const fieldInput = (name: string): HTMLInputElement => expectInstance(form.elements.namedItem(name), HTMLInputElement, `form field ${name}`);
const fieldTextarea = (name: string): HTMLTextAreaElement => expectInstance(form.elements.namedItem(name), HTMLTextAreaElement, `form field ${name}`);
const fieldRadios = (name: string): RadioNodeList => expectInstance(form.elements.namedItem(name), RadioNodeList, `form field ${name}`);
const fType = fieldRadios('type');
const fName = fieldInput('name');
const fUsername = fieldInput('username');
const fPassword = fieldInput('password');
const fUris = fieldInput('uris');
const fCardholder = fieldInput('cardholder');
const fCardNumber = fieldInput('cardNumber');
const fCardExpiry = fieldInput('cardExpiry');
const fCardCvv = fieldInput('cardCvv');
const fSshSource = fieldRadios('sshSource');
const fSshAlgo = fieldRadios('sshAlgo');
const fSshTitle = fieldInput('sshTitle');
const fSshPublicKey = fieldTextarea('sshPublicKey');
const fSshFingerprint = fieldInput('sshFingerprint');
const fSshPrivateKey = fieldInput('sshPrivateKey');
const fSshHost = fieldInput('sshHost');
const fSshUser = fieldInput('sshUser');
const fSshPort = fieldInput('sshPort');
const fNotes = fieldTextarea('notes');
const fFavorite = fieldInput('favorite');

function setType(type: string): void {
  query(form, `input[name="type"][value="${type}"]`, HTMLInputElement).checked = true;
  query(form, '.login-only', HTMLElement).hidden = type !== 'login';
  query(form, '.card-only', HTMLElement).hidden = type !== 'card';
  query(form, '.identity-only', HTMLElement).hidden = type !== 'identity';
  query(form, '.ssh-only', HTMLElement).hidden = type !== 'ssh';
  if (type === 'ssh') ensureSshKey();
}
form.addEventListener('change', (e) => {
  const target = e.target;
  if (target instanceof HTMLInputElement && target.name === 'type') setType(target.value);
});

fCardNumber.addEventListener('input', () => { fCardNumber.value = fmtCardNumber(fCardNumber.value); });
fCardExpiry.addEventListener('input', () => { fCardExpiry.value = fmtCardExpiry(fCardExpiry.value); });
fCardCvv.addEventListener('input', () => { fCardCvv.value = fCardCvv.value.replace(/\D/g, '').slice(0, 4); });

const confirmSshPubOnly = (): Promise<boolean> =>
  confirm({ title: t('sshpub.title'), body: rich(t('sshpub.body')), okLabel: t('sshpub.save'), cancelLabel: t('common.cancel') });

// Generating or importing another key on an item that already has one: on save, the previous one is lost.
let sshOverwriteOk = false;
async function confirmSshOverwrite(action: 'generate' | 'import'): Promise<boolean> {
  if (sshOverwriteOk || !state.editing?.sshPublicKey) return true;
  const gen = action === 'generate';
  sshOverwriteOk = await confirm({
    title: t(gen ? 'sshover.titleGen' : 'sshover.titleImport'),
    body: t(gen ? 'sshover.textGen' : 'sshover.textImport'),
    okLabel: t(gen ? 'ssh.regen' : 'ssh.chooseFile'),
    cancelLabel: t('common.cancel'),
  });
  return sshOverwriteOk;
}

// SSH key in the editor: generating/importing runs on the server; the key fields are read-only.
const paintSectionTitles = (): void => queryAll(form, '.ssh-only [data-icon]', HTMLElement).forEach((n) => n.replaceChildren(icon(iconNameOf(n)), ...rich(t(data(n, 'titleKey')))));
let sshBusy = false;

function sshPaintPreview(): void {
  const base = fSshPublicKey.dataset['base'];
  fSshPublicKey.value = base ? sshPubLine(base, fSshTitle.value.trim()) : '';
  $('#ssh-config').textContent = sshConfig({ name: fName.value, sshAlgo: fSshAlgo.value, sshHost: fSshHost.value.replace(/\s+/g, ''), sshUser: fSshUser.value.replace(/\s+/g, ''), sshPort: fSshPort.value });
}
interface SshKeyInput {
  algo: string;
  publicKey: string;
  fingerprint: string;
  privateKey: string;
  comment?: string | undefined;
}
function sshSetKey(k: SshKeyInput | null): void {
  fSshPublicKey.dataset['base'] = k?.publicKey || '';
  fSshFingerprint.value = k?.fingerprint || '';
  fSshPrivateKey.value = k?.privateKey || '';
  if (k) fSshAlgo.value = k.algo;
  if (k?.comment) fSshTitle.value = k.comment.slice(0, 128);
  sshPaintPreview();
}
function sshPaintMode(): void {
  const importing = fSshSource.value === 'import';
  $('#ssh-algo-seg').hidden = importing;
  $('#ssh-import').hidden = !importing;
  $('#ssh-regen-row').hidden = importing;
}
async function sshGenerate(): Promise<void> {
  if (sshBusy) return;
  sshBusy = true;
  $('#edit-error').textContent = '';
  fSshPrivateKey.placeholder = t('ssh.generating');
  sshSetKey(null);
  try {
    sshSetKey(await api('POST /api/ssh/generate', { guard: guardSshKeyResponse, body: { algo: fSshAlgo.value } }));
  } catch (ex) { $('#edit-error').textContent = msgOf(ex); }
  fSshPrivateKey.placeholder = '••••••••';
  sshBusy = false;
}
function ensureSshKey(): void {
  if (!fSshPublicKey.dataset['base'] && fSshSource.value === 'new') sshGenerate();
}
const sshPaste = $textarea('#ssh-paste');
async function sshImport(): Promise<void> {
  const text = sshPaste.value;
  $('#edit-error').textContent = '';
  try {
    sshSetKey(await api('POST /api/ssh/inspect', { guard: guardSshKeyResponse, body: { privateKey: text } }));
    sshPaste.value = '';
    toast(t('ssh.imported'));
  } catch (ex) { $('#edit-error').textContent = msgOf(ex); }
}
form.addEventListener('change', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name === 'sshSource') {
    sshPaintMode();
    sshSetKey(null);
    if (target.value === 'new') sshGenerate();
  }
  if (target.name === 'sshAlgo' && fSshSource.value === 'new') sshGenerate();
});
$('#ssh-regen').addEventListener('click', async () => { if (await confirmSshOverwrite('generate')) sshGenerate(); });
// Imports on its own: when a complete key is pasted, or when leaving the field with something typed.
sshPaste.addEventListener('input', () => { if (/-----END [A-Z ]*PRIVATE KEY-----/.test(sshPaste.value)) sshImport(); });
sshPaste.addEventListener('blur', () => { if (sshPaste.value.trim()) sshImport(); });
$('#ssh-pick').addEventListener('click', async () => { if (await confirmSshOverwrite('import')) $('#ssh-file').click(); });
const sshFile = $input('#ssh-file');
sshFile.addEventListener('change', async () => {
  const file = firstFile(sshFile);
  sshFile.value = '';
  if (!file) return;
  if (file.size > 20000) { $('#edit-error').textContent = t('ssh.fileTooLarge'); return; }
  sshPaste.value = await file.text();
  sshImport();
});
queryAll(form, '[data-ssh-copy]', HTMLButtonElement).forEach((b) => {
  b.replaceChildren(icon('copy'));
  b.addEventListener('click', () => {
    const which = dataOneOf(b, 'sshCopy', ['public', 'fingerprint', 'private'] as const);
    const v = { public: fSshPublicKey.value, fingerprint: fSshFingerprint.value, private: fSshPrivateKey.value }[which];
    if (v) copy(v, { public: t('ssh.public'), fingerprint: t('ssh.fingerprint'), private: t('ssh.private') }[which], { sensitive: which === 'private' });
  });
});
$('#ssh-copy-config').addEventListener('click', () => copy(textOf($('#ssh-config')), 'config', { sensitive: false }));
for (const input of [fName, fSshTitle, fSshHost, fSshUser]) input.addEventListener('input', sshPaintPreview);
fSshPort.addEventListener('input', () => { fSshPort.value = fSshPort.value.replace(/\D/g, '').slice(0, 5); sshPaintPreview(); });

// The placeholder follows the field state: mask with • when hidden, real example when visible.
const SECRET_PLACEHOLDERS = {
  password: ['••••••••', 'my-password-123'],
  cardNumber: ['•••• •••• •••• ••••', '1234 5678 9012 3456'],
  cardCvv: ['•••', '0123'],
} as const;

// One eye per secret field of the editor (the SSH private key, the login password, the card number and CVV).
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
  createRevealToggle({ input: fSshPrivateKey, button: $button('#ssh-reveal'), label: (shown) => t(shown ? 'reveal.privateKey.hide' : 'reveal.privateKey.show') }),
];
// A secret is never left showing from a previous item: opening the editor puts every one back to hidden (S3).
const resetSecrets = (): void => { for (const toggle of revealToggles) toggle.setShown(false); };

function openEditor(item: VaultItem | null): void {
  clearFieldErrors();
  state.editing = item;
  sshOverwriteOk = false;
  form.reset();
  $('#edit-error').textContent = '';
  paintEditTitle(item);
  $('#btn-delete').hidden = !item;
  fSshPublicKey.dataset['base'] = '';
  resetSecrets();
  setType(item?.type || 'login');
  fName.value = item?.name || '';
  fUsername.value = item?.username || '';
  fPassword.value = item?.password || '';
  fUris.value = item?.uris?.[0] || '';
  setFolderValue(item?.folder || (state.folder || ''));
  folderMenuHandle.close();
  fCardholder.value = item?.cardholder || '';
  fCardNumber.value = item?.cardNumber || '';
  fCardExpiry.value = item?.cardExpiry || '';
  fCardCvv.value = item?.cardCvv || '';
  for (const k of IDENTITY_KEYS) fieldInput(k).value = item?.[k] || '';
  fSshTitle.value = item?.sshTitle || '';
  fSshHost.value = item?.sshHost || '';
  fSshUser.value = item?.sshUser || '';
  fSshPort.value = item?.sshPort || '';
  if (item?.sshPublicKey) sshSetKey({ algo: item.sshAlgo, publicKey: item.sshPublicKey, fingerprint: item.sshFingerprint, privateKey: item.sshPrivateKey });
  else sshPaintPreview();
  sshPaintMode();
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

// Validation of fields with a defined format (ui/validators.ts). An empty field is always accepted (only Name is required).
// Fields validated for each item type (those of other types are hidden and don't count).
const VALIDATED_BY_TYPE: Readonly<Record<ItemType, readonly ValidatedField[]>> = {
  login: ['uris'],
  card: ['cardNumber', 'cardExpiry', 'cardCvv'],
  identity: ['email', 'birthDate', 'phone', 'cpf', 'cnpj', 'pis', 'cnh', 'zip'],
  ssh: ['sshHost', 'sshPort'],
  note: [],
};

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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm()) return;
  if (fType.value === 'ssh') {
    if (!fSshPublicKey.dataset['base']) { $('#edit-error').textContent = t('ssh.needKey'); return; }
    if (!fSshPrivateKey.value && !await confirmSshPubOnly()) return;
  }
  const payload = {
    type: fType.value,
    name: fName.value,
    username: fUsername.value,
    password: fPassword.value,
    uris: [fUris.value.trim(), ...(state.editing?.uris || []).slice(1)].filter(Boolean),
    folder: folderInput.value,
    cardholder: fCardholder.value,
    cardNumber: fCardNumber.value,
    cardExpiry: fCardExpiry.value,
    cardCvv: fCardCvv.value,
    ...Object.fromEntries(IDENTITY_KEYS.map((k) => [k, fieldInput(k).value])),
    sshAlgo: fSshAlgo.value,
    sshTitle: fSshTitle.value,
    sshPublicKey: fSshPublicKey.dataset['base'] || '',
    sshFingerprint: fSshFingerprint.value,
    sshPrivateKey: fSshPrivateKey.value,
    sshHost: fSshHost.value,
    sshUser: fSshUser.value,
    sshPort: fSshPort.value,
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

// ---------- Generator ----------
const generator = initGenerator();

initImportExport({ refresh });

initSecurity();

boot().catch(toastError);
