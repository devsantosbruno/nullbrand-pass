/** Returned by {@link readJson} when the body is not JSON. */
export const NOT_JSON = Symbol('not-json');
/** Reads a response body as untrusted data; it stays `unknown` until a guard has checked it. */
export async function readJson(res: Response): Promise<unknown> {
  try {
    const body: unknown = await res.json();
    return body;
  } catch {
    return NOT_JSON;
  }
}
