// The page's single mutable state. Components in ui/ never import it.
import type { PublicItem, StatusResponse } from './api.js';
import type { VaultItem } from './vault-types.js';
import { DomValueError } from './dom.js';

/** What the page currently shows: loaded data, filters and selection. */
export interface State {
  status: StatusResponse | null;
  items: PublicItem[];
  filter: string;
  folder: string | null;
  folders: string[];
  query: string;
  selection: Set<string>;
  selectedId: string | null;
  current: VaultItem | null;
  editing: VaultItem | null;
}
/** The shared {@link State} instance. */
export const state: State = { status: null, items: [], filter: 'all', folder: null, folders: [], query: '', selection: new Set(), selectedId: null, current: null, editing: null };

/** Returns the item in the detail pane. @throws {DomValueError} when none is loaded; callers run only after one is. */
export function currentItem(): VaultItem {
  const item = state.current;
  if (item === null) throw new DomValueError('no item is selected');
  return item;
}
