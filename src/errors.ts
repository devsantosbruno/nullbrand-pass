import type { TranslateParams } from './shared/i18n.js';

/** Error carrying an i18n `key` and `params`. `message` stays English for logs and library users; the CLI and web UI translate via `key`. */
export interface CodedError extends Error {
  readonly key: string;
  readonly params: TranslateParams;
}

/** Creates a {@link CodedError}. */
export function coded(key: string, message: string, params: TranslateParams = {}): CodedError {
  return Object.assign(new Error(message), { key, params });
}
