// Picks the adapter for a file. Nothing is guessed: a file no adapter is sure about is "unrecognized".
import { coded } from '../errors.js';
import { isObjectLike } from '../shared/guards.js';
import type { ImportAdapter } from './types.js';

// Below this an adapter is not sure enough to be trusted with the file.
export const MIN_CONFIDENCE = 0.5;

// The text as a JSON document of unknown shape. Deeply nested input that overflows the parser's stack is "not JSON" too.
export function readJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text.replace(/^﻿/, ''));
    return parsed;
  } catch {
    throw coded('err.import.notJson', 'Invalid file: not JSON.');
  }
}

// The adapter with the highest score. It has to reach MIN_CONFIDENCE, and the best score may not be shared by two adapters unless it is
// a certainty.
export function pickAdapter(adapters: readonly ImportAdapter[], document: unknown): ImportAdapter {
  const scored = adapters.map((adapter) => ({ adapter, score: adapter.detect(document) })).sort((a, b) => b.score - a.score);
  const [best, runnerUp] = scored;
  const unambiguous = best !== undefined && (best.score >= 1 || runnerUp === undefined || runnerUp.score < best.score);
  if (best === undefined || best.score < MIN_CONFIDENCE || !unambiguous) {
    throw coded('err.import.unrecognized', 'This file is not in a supported format.');
  }
  return best.adapter;
}

// Documents that are valid JSON but must not be fed to an adapter, with the reason the user needs.
export function rejectKnownMisfits(document: unknown, backupFormat: string): void {
  if (!isObjectLike(document)) return;
  if (document['format'] === backupFormat) {
    throw coded('err.import.nativeBackup', 'This is a nullbrand backup: use "import backup" (or Restore) instead.');
  }
  if (document['encrypted'] === true) {
    throw coded('err.import.encryptedForeign', 'This export is encrypted. Export it again unencrypted.');
  }
}
