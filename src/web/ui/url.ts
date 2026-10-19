// URL helpers shared by the list, the viewer and the editor. Pure: no DOM.
const SCHEME = /^[a-z]+:\/\//i;

// A site as typed ("example.com") becomes a URL the browser can parse; one that already has a scheme is left alone.
export const normalizeUrl = (u: string): string => (SCHEME.test(u) ? u : `https://${u}`);
// Only http(s) ever becomes a link (S7): `javascript:`, `data:` and `file:` have no `//` after the scheme or are not web pages.
export const isHttpUrl = (u: string): boolean => /^https?:\/\//i.test(normalizeUrl(u));
export const hostOf = (u: string): string => {
  try { return new URL(normalizeUrl(u)).hostname.replace(/^www\./, ''); } catch { return u; }
};
export const siteDomain = (u: string): string => {
  try { return new URL(normalizeUrl(u)).host; } catch { return u.replace(SCHEME, '').replace(/\/+$/, ''); }
};
