// The only module that talks to the local server. The session lives in an HttpOnly cookie, so JS never sees the token.
// Every answer is `unknown` until its guard has checked it.
import { errText } from './i18n.js';
import type { ApiResponses, ApiRoute } from './api.js';
import { isApiErrorResponse } from './api-guards.js';
import type { Guard } from './api-guards.js';
import { errorMessage } from './guards.js';
import { NOT_JSON, readJson } from './json.js';
import { t } from './locale.js';

/** A response with an unexpected shape. Nothing is rendered from it and the screen stays as it was. `route` and `reason` (field names, never values) go to the console; the message is the translated, visible one. */
export class ApiResponseError extends Error {
  readonly route: string;
  readonly reason: string;
  constructor(route: string, reason: string) {
    super(t('err.http.invalidResponse'));
    this.name = 'ApiResponseError';
    this.route = route;
    this.reason = reason;
    console.error('nullbrand: invalid response from the local server', { route, reason });
  }
}

/** A non-2xx answer from the server; the message is already translated. */
export class ApiError extends Error {
  readonly status: number;
  readonly key: string | undefined;
  constructor(message: string, status: number, key: string | undefined) {
    super(message);
    this.status = status;
    this.key = key;
  }
}

// Screen to show when the session is gone (401) or the vault is locked (423); the page, which owns the screens, sets it once.
type SessionScreen = 'nosession' | 'unlock';
let onSessionScreen: (screen: SessionScreen) => void = () => {};
/** Registers the function that shows the `nosession` or `unlock` screen. */
export function setSessionScreenHandler(handler: (screen: SessionScreen) => void): void {
  onSessionScreen = handler;
}

/**
 * Calls a local API route and returns its validated answer.
 * @param route the "METHOD /path" key of `ApiResponses`.
 * @param path the real URL, when the route has a `:id`.
 * @param guard checks the body of a 2xx answer.
 * @throws {ApiResponseError} when a 2xx body fails the guard.
 * @throws {ApiError} on a non-2xx status; its body is read for message, key and params only when it is a valid error body, else a generic message is used.
 */
export async function api<K extends ApiRoute>(route: K, { guard, body, path }: { guard: Guard<ApiResponses[K]>; body?: object; path?: string }): Promise<ApiResponses[K]> {
  const [method = '', routePath = ''] = route.split(' ');
  const res = await fetch(path ?? routePath, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null,
  });
  const answer = await readJson(res);
  const errorBody = isApiErrorResponse(answer) ? answer : undefined;
  if (res.status === 401 && errorBody?.key === 'err.http.noSession') onSessionScreen('nosession');
  if (!res.ok) {
    const key = errorBody?.key || (res.status === 423 ? 'err.http.locked' : undefined);
    const message = !errorBody?.error && !key
      ? t('err.http.generic', { status: res.status })
      : errText(t, { key, params: errorBody?.params, message: errorBody?.error }) || t('err.http.generic', { status: res.status });
    if (res.status === 423) onSessionScreen('unlock');
    throw new ApiError(message, res.status, key);
  }
  if (answer === NOT_JSON) throw new ApiResponseError(route, 'response: not valid JSON');
  const checked = guard(answer);
  if (!checked.ok) throw new ApiResponseError(route, checked.reason);
  return checked.value;
}

/** Returns the message of a caught value for `textContent`, or `null`. */
export const msgOf = (ex: unknown): string | null => errorMessage(ex) ?? null;
