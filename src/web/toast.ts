// The toast, the short message at the bottom, and helpers that turn a caught error into one.
import { $ } from './dom.js';
import { ApiResponseError, msgOf } from './http.js';

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Shows a message for `ms` milliseconds. */
export function toast(msg: string | null, ms = 2200): void {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// An invalid response is rare and must not go unnoticed, so its toast lasts longer.
const INVALID_RESPONSE_TOAST_MS = 8000;
/** Returns `ms`, raised to the longer duration for an {@link ApiResponseError}. */
export const toastMs = (ex: unknown, ms: number): number => (ex instanceof ApiResponseError ? Math.max(ms, INVALID_RESPONSE_TOAST_MS) : ms);
/** Shows the message of a caught error. */
export const toastError = (ex: unknown): void => toast(msgOf(ex), toastMs(ex, 2200));
/** For calls with no handler of their own: toasts an {@link ApiResponseError} and rethrows anything else. */
export function toastIfInvalidResponse(ex: unknown): void {
  if (ex instanceof ApiResponseError) toastError(ex);
  else throw ex;
}
