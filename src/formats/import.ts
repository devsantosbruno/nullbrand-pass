// The single import flow: text in, a plan out (what would be added, what was lossy). The caller commits it.
import { coded } from '../errors.js';
import type { CodedError } from '../errors.js';
import { FORMAT } from '../vault.js';
import { pickAdapter, readJson, rejectKnownMisfits } from './detect.js';
import { applyFolderPolicy } from './folders.js';
import { ADAPTERS } from './registry.js';
import type { FormatWarning, InterchangeItem } from './types.js';

/** Largest import file accepted, in bytes. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** Where imported items go. */
export interface ImportOptions {
  /** Destination folder. */
  folder?: string;
  /** Drop the folders written in the file; they are kept by default. */
  ignoreFolders?: boolean;
  /** Folders already in the vault, so a destination typed with other casing reuses the existing spelling. */
  existingFolders?: readonly string[];
}

/** What an import would add, and what was lossy or skipped. */
export interface ImportPlan {
  items: InterchangeItem[];
  ignored: number;
  warnings: FormatWarning[];
}

/** Builds the error for a file over {@link MAX_IMPORT_BYTES}. */
export function tooLarge(): CodedError {
  const max = MAX_IMPORT_BYTES / 1024 / 1024;
  return coded('err.import.tooLarge', `The file is larger than ${max} MiB.`, { max });
}

/**
 * Reads and recognizes a file. Placing the items is a separate step ({@link placeImport}), so a caller can show what was read,
 * look at the vault's folders, and only then place them.
 * @throws coded `err.import.*` when the file is too large, not JSON, a native backup, encrypted or unrecognized.
 */
export function parseImport(text: string): ImportPlan {
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw tooLarge();
  const document = readJson(text);
  rejectKnownMisfits(document, FORMAT);
  return pickAdapter(ADAPTERS, document).parse(document);
}

/** Applies the folder options of {@link ImportOptions} to a parsed plan. */
export function placeImport(plan: ImportPlan, options: ImportOptions = {}): ImportPlan {
  const placed = applyFolderPolicy(plan.items, { destination: options.folder, keepFolders: options.ignoreFolders !== true, existing: options.existingFolders });
  return { ...plan, items: placed.items, warnings: [...plan.warnings, ...placed.warnings] };
}

/** Parses and places in one step: {@link parseImport} then {@link placeImport}. */
export function planImport(text: string, options: ImportOptions = {}): ImportPlan {
  return placeImport(parseImport(text), options);
}
