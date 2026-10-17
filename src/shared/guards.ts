// Hand-written type guards shared by the Node side and the web UI. Pure: no Node or DOM APIs.
// Rule: to ask whether an object HAS a key, use Object.hasOwn(obj, key), never `key in obj` (`in` walks the prototype chain).

// Any non-null object: reading a missing property of it gives `undefined`, exactly like `value?.key` did.
export function isObjectLike(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

// Array.isArray() narrows `unknown` to `any[]`; this guard narrows it to `readonly unknown[]` instead, so no `any` leaks in.
export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function isStringArray(value: unknown): value is readonly string[] {
  return isUnknownArray(value) && value.every((element) => typeof element === 'string');
}

// The `message` of anything that was thrown, when it has a string one (undefined for non-errors / message-less values).
export function errorMessage(err: unknown): string | undefined {
  return isObjectLike(err) && typeof err['message'] === 'string' ? err['message'] : undefined;
}

// `{ ...value }` for a value of any type: null / undefined / numbers give {}, strings spread their characters, objects copy their own
// enumerable properties. The callers only read string keys, so own enumerable string keys are all that has to be copied.
export function spreadOf(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  return Object.fromEntries(Object.entries(value));
}

// `err.code === code` for a caught value of any type (a missing / non-object error simply does not match).
export function hasErrorCode(err: unknown, code: string): boolean {
  return isObjectLike(err) && err['code'] === code;
}
