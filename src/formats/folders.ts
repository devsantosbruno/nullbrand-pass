// Where imported items land. Folders in the vault are flat strings, so `Destination/Folder` is a naming convention, not a hierarchy.
import { FOLDER_MAX } from '../shared/vault-types.js';
import type { FormatWarning, InterchangeItem } from './types.js';

export interface FolderPolicy {
  // Optional folder every item goes into (or, with keepFolders, that prefixes the folders of the file).
  destination?: string | undefined;
  // true: the folders of the file are kept. false: they are dropped.
  keepFolders: boolean;
  // Folders that already exist in the vault. A destination that differs from one only by case reuses that spelling.
  existing?: readonly string[] | undefined;
}

function pickDestination({ destination = '', existing = [] }: FolderPolicy): string {
  const wanted = destination.trim();
  return existing.find((folder) => folder.toLowerCase() === wanted.toLowerCase()) ?? wanted;
}

export function applyFolderPolicy(items: readonly InterchangeItem[], policy: FolderPolicy): { items: InterchangeItem[]; warnings: FormatWarning[] } {
  const destination = pickDestination(policy);
  let tooLong = 0;
  const placed = items.map((item): InterchangeItem => {
    const own = policy.keepFolders ? item.folder : '';
    const folder = own && destination ? `${destination}/${own}` : own || destination;
    if (folder.length > FOLDER_MAX) tooLong++;
    return { ...item, folder };
  });
  // The cut itself is done by the vault when it normalises the item.
  const warnings: FormatWarning[] = tooLong > 0 ? [{ key: 'import.warn.folderTruncated', params: { count: tooLong, max: FOLDER_MAX } }] : [];
  return { items: placed, warnings };
}
