// The one mutable state object of the page. Components in ui/ never import it; features receive what they need as parameters or import it
// from here.
import type { PublicItem, StatusResponse } from './api.js';
import type { VaultItem } from './vault-types.js';
import { DomValueError } from './dom.js';

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
export const state: State = { status: null, items: [], filter: 'all', folder: null, folders: [], query: '', selection: new Set(), selectedId: null, current: null, editing: null };

// The item shown in the detail pane. The callers run only after one was loaded.
export function currentItem(): VaultItem {
  const item = state.current;
  if (item === null) throw new DomValueError('no item is selected');
  return item;
}
