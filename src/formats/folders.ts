// Where imported items land. Folders in the vault are flat strings, so `Destination/Folder` is a naming convention, not a hierarchy.
import { FOLDER_MAX } from '../shared/vault-types.js';
import type { FormatWarning, InterchangeItem } from './types.js';

/** Where imported items land. */
export interface FolderPolicy {
  /** Folder every item goes into, or, with `keepFolders`, a prefix for the folders of the file. */
  destination?: string | undefined;
  /** Keep the folders written in the file (true) or drop them (false). */
  keepFolders: boolean;
  /** Folders already in the vault; a destination differing from one only by case reuses its spelling. */
  existing?: readonly string[] | undefined;
}

function pickDestination({ destination = '', existing = [] }: FolderPolicy): string {
  const wanted = destination.trim();
  return existing.find((folder) => folder.toLowerCase() === wanted.toLowerCase()) ?? wanted;
}

/** Assigns a folder to every item under `policy`, warning about names that the vault will truncate. */
export function applyFolderPolicy(items: readonly InterchangeItem[], policy: FolderPolicy): { items: InterchangeItem[]; warnings: FormatWarning[] } {
  const destination = pickDestination(policy);
  let tooLong = 0;
  const placed = items.map((item): InterchangeItem => {
    const own = policy.keepFolders ? item.folder : '';
    const folder = own && destination ? `${destination}/${own}` : own || destination;
    if (folder.length > FOLDER_MAX) tooLong++;
    return { ...item, folder };
  });
  // The vault does the actual truncation when it normalizes the item.
  const warnings: FormatWarning[] = tooLong > 0 ? [{ key: 'import.warn.folderTruncated', params: { count: tooLong, max: FOLDER_MAX } }] : [];
  return { items: placed, warnings };
}
