// Picks the adapter for a file. Nothing is guessed: a file no adapter is sure about is unrecognized.
import { coded } from '../errors.js';
import { isObjectLike } from '../shared/guards.js';
import type { ImportAdapter } from './types.js';

/** Score below which an adapter is not trusted with a file. */
export const MIN_CONFIDENCE = 0.5;

/**
 * Parses text as a JSON document of unknown shape. Input so deeply nested that it overflows the parser's stack counts as not JSON too.
 * @throws coded `err.import.notJson`.
 */
export function readJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text.replace(/^﻿/, ''));
    return parsed;
  } catch {
    throw coded('err.import.notJson', 'Invalid file: not JSON.');
  }
}

/**
 * Returns the adapter with the highest score. It must reach {@link MIN_CONFIDENCE}, and two adapters may not tie unless the score is a certainty.
 * @throws coded `err.import.unrecognized`.
 */
export function pickAdapter(adapters: readonly ImportAdapter[], document: unknown): ImportAdapter {
  const scored = adapters.map((adapter) => ({ adapter, score: adapter.detect(document) })).sort((a, b) => b.score - a.score);
  const [best, runnerUp] = scored;
  const unambiguous = best !== undefined && (best.score >= 1 || runnerUp === undefined || runnerUp.score < best.score);
  if (best === undefined || best.score < MIN_CONFIDENCE || !unambiguous) {
    throw coded('err.import.unrecognized', 'This file is not in a supported format.');
  }
  return best.adapter;
}

/**
 * Rejects valid JSON that must not reach an adapter, with the reason the user needs.
 * @param backupFormat the `format` value of a native backup.
 * @throws coded `err.import.nativeBackup` or `err.import.encryptedForeign`.
 */
export function rejectKnownMisfits(document: unknown, backupFormat: string): void {
  if (!isObjectLike(document)) return;
  if (document['format'] === backupFormat) {
    throw coded('err.import.nativeBackup', 'This is a nullbrand backup: use "import backup" (or Restore) instead.');
  }
  if (document['encrypted'] === true) {
    throw coded('err.import.encryptedForeign', 'This export is encrypted. Export it again unencrypted.');
  }
}
