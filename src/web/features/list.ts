// The item list: filtering by the sidebar and the search box, selecting one item to open it, and selecting several to move or delete.
import type { PublicItem } from '../api.js';
import { guardCountResponse } from '../api-guards.js';
import { $, $button, $input, el } from '../dom.js';
import { confirmDelete } from '../dialogs.js';
import { api } from '../http.js';
import { t } from '../locale.js';
import { showDetail } from '../shell.js';
import { state } from '../state.js';
import { toast, toastError } from '../toast.js';
import { icon } from '../ui/icons.js';
import type { IconName } from '../ui/icons.js';
import { createMenu } from '../ui/menu.js';
import { hostOf } from '../ui/url.js';
import type { ItemType } from '../vault-types.js';

/** What the list needs from the other features. */
export interface ListDeps {
  /** Opens an item in the detail pane. */
  select(id: string): Promise<void>;
  /** Asks for a new folder name; the folders feature owns the dialog. */
  promptNewFolder(): Promise<string | null>;
  refresh(): Promise<void>;
}
/** What the list exposes to the page. */
export interface ListHandle {
  renderList(): void;
}

const TYPE_ICONS: Readonly<Partial<Record<ItemType, IconName>>> = { note: 'pencil', card: 'card', identity: 'id', ssh: 'key-down' };

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

/** Wires the item list, search and bulk selection, and returns its handle. */
export function initList({ select, promptNewFolder, refresh }: ListDeps): ListHandle {
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

  // Rebuilt on every open so it reflects the current folders.
  function renderSelMenu(): void {
    const opt = (label: string, onClick: () => void | Promise<void>, extra: { sep?: boolean; count?: number } = {}): HTMLButtonElement => {
      const b = el('button', { type: 'button', className: `select-item${extra.sep ? ' sep' : ''}` }, el('span', { textContent: label }), extra.count != null ? el('span', { className: 'n', textContent: extra.count }) : null);
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', onClick);
      return b;
    };
    selMenu.replaceChildren(
      ...state.folders.map((f) => opt(f, () => moveSelection(f), { count: state.items.filter((i) => i.folder === f).length })),
      opt(t('folder.newEllipsis'), async () => {
        const name = await promptNewFolder();
        if (name) moveSelection(name); else selMenuHandle.close();
      }, { sep: state.folders.length > 0 }),
      opt(t('folder.none'), () => moveSelection(''))
    );
  }
  const selMenuHandle = createMenu({ trigger: selFolderBtn, menu: selMenu, itemSelector: '.select-item', onOpen: renderSelMenu });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selection.size && !selMenuHandle.isOpen && !document.querySelector('dialog[open]')) clearSelection();
  });

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

  return { renderList };
}
