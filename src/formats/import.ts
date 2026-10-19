// The one import flow: text in, a plan out (what would be added, what was lossy). The caller commits it.
import { coded } from '../errors.js';
import type { CodedError } from '../errors.js';
import { FORMAT } from '../vault.js';
import { pickAdapter, readJson, rejectKnownMisfits } from './detect.js';
import { applyFolderPolicy } from './folders.js';
import { ADAPTERS } from './registry.js';
import type { FormatWarning, InterchangeItem } from './types.js';

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export interface ImportOptions {
  // Destination folder, and whether the folders written in the file are kept (default) or dropped.
  folder?: string;
  ignoreFolders?: boolean;
  // Folders already in the vault, so a destination typed with other casing reuses the existing spelling.
  existingFolders?: readonly string[];
}

export interface ImportPlan {
  items: InterchangeItem[];
  ignored: number;
  warnings: FormatWarning[];
}

export function tooLarge(): CodedError {
  const max = MAX_IMPORT_BYTES / 1024 / 1024;
  return coded('err.import.tooLarge', `The file is larger than ${max} MiB.`, { max });
}

// Reads and recognises the file. Where the items will go is a separate step (placeImport), so a caller can show what was read, then
// look at the vault's folders, and only then place the items.
export function parseImport(text: string): ImportPlan {
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw tooLarge();
  const document = readJson(text);
  rejectKnownMisfits(document, FORMAT);
  return pickAdapter(ADAPTERS, document).parse(document);
}

// Applies the folder options: destination folder, and keeping or dropping the folders written in the file.
export function placeImport(plan: ImportPlan, options: ImportOptions = {}): ImportPlan {
  const placed = applyFolderPolicy(plan.items, { destination: options.folder, keepFolders: options.ignoreFolders !== true, existing: options.existingFolders });
  return { ...plan, items: placed.items, warnings: [...plan.warnings, ...placed.warnings] };
}

export function planImport(text: string, options: ImportOptions = {}): ImportPlan {
  return placeImport(parseImport(text), options);
}
