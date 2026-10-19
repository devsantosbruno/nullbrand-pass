// Hand-written type guards, shared by the Node side and the web UI, that narrow `unknown` without type assertions. Pure: no Node or DOM APIs.
// To ask whether an object has a key, use Object.hasOwn(obj, key), never `key in obj` (`in` walks the prototype chain).

/** Narrows to any non-null object, arrays included; reading a missing property gives `undefined`. */
export function isObjectLike(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Narrows to `readonly unknown[]`; `Array.isArray` would give `any[]` and leak `any`. */
export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Narrows to an array whose every element is a string. */
export function isStringArray(value: unknown): value is readonly string[] {
  return isUnknownArray(value) && value.every((element) => typeof element === 'string');
}

/** Returns the string `message` of anything thrown, or `undefined` if it has none. */
export function errorMessage(err: unknown): string | undefined {
  return isObjectLike(err) && typeof err['message'] === 'string' ? err['message'] : undefined;
}

/** Behaves like `{ ...value }` for a value of any type: null, undefined and numbers give `{}`, strings spread their characters, objects copy their own enumerable string keys. */
export function spreadOf(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  return Object.fromEntries(Object.entries(value));
}

/** Returns whether a caught value of any type has this `code`; non-objects simply do not match. */
export function hasErrorCode(err: unknown, code: string): boolean {
  return isObjectLike(err) && err['code'] === code;
}
