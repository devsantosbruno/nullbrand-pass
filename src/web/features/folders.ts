// Folders: the sidebar list and filters, the folder picker of the editor, and the dialogs to create, rename, merge and delete one.
import { guardFolderDeleteResponse, guardFolderList, guardFolderNameResponse } from '../api-guards.js';
import { $, $button, $dialog, $form, $input, DomValueError, data, el, expectInstance, query, queryAll } from '../dom.js';
import { api, msgOf } from '../http.js';
import { t } from '../locale.js';
import { showDetail } from '../shell.js';
import { state } from '../state.js';
import { toast, toastError } from '../toast.js';
import { openDialog } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { createMenu, flipUp } from '../ui/menu.js';

/** What the folders feature needs from the page. */
export interface FoldersDeps {
  renderList(): void;
  /** Reloads items and folders, then repaints the sidebar and the list. */
  refresh(): Promise<void>;
}
/** What the folders feature exposes to the page. */
export interface FoldersHandle {
  renderSidebar(): void;
  /** The editor's folder picker: current value. */
  value(): string;
  setValue(folder: string): void;
  closeMenu(): void;
  /** Opens the new-folder dialog; resolves with the folder name (existing or new), or `null` if cancelled. */
  promptNew(): Promise<string | null>;
  /** Rewrites the picker's language-dependent label ("No folder"). */
  repaint(): void;
}

/** Wires the sidebar, the editor's folder picker and the folder dialogs, and returns its handle. */
export function initFolders({ renderList, refresh }: FoldersDeps): FoldersHandle {
  // ---------- Folder select (in the editor) ----------
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
    const list = state.folders;
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

  // ---------- Sidebar ----------
  function renderSidebar(): void {
    $('#count-all').textContent = String(state.items.length);
    for (const b of queryAll(document, '.filter', HTMLElement)) b.classList.toggle('active', !state.folder && b.dataset['filter'] === state.filter);
    const nav = $('#folders');
    nav.replaceChildren();
    const list = state.folders;
    if (list.length === 0) nav.append(el('p', { className: 'muted small folders-empty', textContent: t('folders.none') }));
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

  // ---------- New folder ----------
  const dlgFolder = $dialog('#dlg-folder');
  const folderName = $input('#folder-name');
  /** Returns the existing folder whose name matches case-insensitively, if any. */
  const folderExists = (name: string): string | undefined => state.folders.find((f) => f.toLowerCase() === name.toLowerCase());

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
  // The dialog only opens through editFolder(), so a folder is always set when this is called.
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

  return {
    renderSidebar,
    value: () => folderInput.value,
    setValue: setFolderValue,
    closeMenu: () => folderMenuHandle.close(),
    promptNew: promptNewFolder,
    repaint: () => setFolderValue(folderInput.value),
  };
}
