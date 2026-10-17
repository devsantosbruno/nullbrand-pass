// Errors that carry an i18n key. `message` stays in English (library consumers, logs);
// the CLI and the web UI translate through `key` + `params` (see shared/i18n.ts, errText).
import type { TranslateParams } from './shared/i18n.js';

export interface CodedError extends Error {
  readonly key: string;
  readonly params: TranslateParams;
}

export function coded(key: string, message: string, params: TranslateParams = {}): CodedError {
  return Object.assign(new Error(message), { key, params });
}
