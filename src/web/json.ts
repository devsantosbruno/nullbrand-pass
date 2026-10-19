// Reading a response body as untrusted data: it stays `unknown` until a guard from api-guards.ts has looked at it.
export const NOT_JSON = Symbol('not-json');
export async function readJson(res: Response): Promise<unknown> {
  try {
    const body: unknown = await res.json();
    return body;
  } catch {
    return NOT_JSON;
  }
}
