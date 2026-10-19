// The toast (the short message at the bottom) and the helpers that turn a caught error into one.
import { $ } from './dom.js';
import { ApiResponseError, msgOf } from './http.js';

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string | null, ms = 2200): void {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// An ApiResponseError reaches the user as a toast (longer than the usual one: it is rare and must not go unnoticed).
const INVALID_RESPONSE_TOAST_MS = 8000;
export const toastMs = (ex: unknown, ms: number): number => (ex instanceof ApiResponseError ? Math.max(ms, INVALID_RESPONSE_TOAST_MS) : ms);
export const toastError = (ex: unknown): void => toast(msgOf(ex), toastMs(ex, 2200));
// For calls that used to have no catch (an error ended up as an unhandled rejection): only the new error is shown; any other is
// thrown again, so it ends up exactly where it did before.
export function toastIfInvalidResponse(ex: unknown): void {
  if (ex instanceof ApiResponseError) toastError(ex);
  else throw ex;
}
