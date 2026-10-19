// URL helpers shared by the list, the viewer and the editor. Pure: no DOM.
const SCHEME = /^[a-z]+:\/\//i;

/** Prefixes `https://` to a site typed without a scheme; one that has a scheme is left alone. */
export const normalizeUrl = (u: string): string => (SCHEME.test(u) ? u : `https://${u}`);
/** Returns whether the site is http(s). Only these ever become links: `javascript:`, `data:` and `file:` must not. */
export const isHttpUrl = (u: string): boolean => /^https?:\/\//i.test(normalizeUrl(u));
/** Returns the hostname without `www.`, or the input if it does not parse. */
export const hostOf = (u: string): string => {
  try { return new URL(normalizeUrl(u)).hostname.replace(/^www\./, ''); } catch { return u; }
};
/** Returns the host (with port) for display, or the input without scheme and trailing slashes if it does not parse. */
export const siteDomain = (u: string): string => {
  try { return new URL(normalizeUrl(u)).host; } catch { return u.replace(SCHEME, '').replace(/\/+$/, ''); }
};
