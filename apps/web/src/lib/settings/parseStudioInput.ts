/**
 * The studio settings (plan p02b, D2b.9): the studio's name and its website
 * address. Pure: the route, the form and `readStudio` (for a stored row) share it.
 */
export type Studio = {
  /** Shown on every page, in the studio, in authenticator apps and in emails. */
  name: string;
  /** An origin (`https://photos.example.com`), no trailing slash; null = the origin each request arrives on. */
  siteUrl: string | null;
};

export const STUDIO_NAME_MAX = 80;

export type StudioParse = { ok: true; value: Studio } | { ok: false; field: 'name' | 'siteUrl'; message: string };

/** Control, format and bidi characters (zero-width spaces, direction overrides): invisible in a title. */
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/u;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseStudioName(input: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof input !== 'string') return { ok: false, message: 'Enter the studio name.' };
  const value = input.normalize('NFC').trim();
  if (!value) return { ok: false, message: 'Enter the studio name.' };
  if ([...value].length > STUDIO_NAME_MAX) return { ok: false, message: `Keep the name to ${STUDIO_NAME_MAX} characters.` };
  if (INVISIBLE_RE.test(value)) return { ok: false, message: 'Remove the invisible or control characters from the name.' };
  return { ok: true, value };
}

/**
 * A website address as typed: `photos.example.com` gets `https://`; the result
 * is an origin (a port is kept). A path, query, fragment or credentials are
 * refused, as is plain `http://` (allowed for localhost in development).
 */
export function parseSiteUrl(input: unknown, opts: { isDevelopment: boolean }): { ok: true; value: string | null } | { ok: false; message: string } {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, message: 'Enter a web address such as photos.example.com.' };
  const text = input.trim();
  if (!text) return { ok: true, value: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: 'Enter a web address such as photos.example.com.' };
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && opts.isDevelopment)) {
    return { ok: false, message: 'The address must start with https://.' };
  }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || withScheme.includes('?') || withScheme.includes('#')) {
    return { ok: false, message: 'Enter only the address, without a page path (photos.example.com).' };
  }
  if (!local && !url.hostname.includes('.')) return { ok: false, message: 'Enter a full domain such as photos.example.com.' };
  if (local && !opts.isDevelopment) return { ok: false, message: 'Enter the public address of this site.' };
  return { ok: true, value: url.origin };
}

export function parseStudioInput(body: unknown, opts: { isDevelopment: boolean }): StudioParse {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const name = parseStudioName(input.name);
  if (!name.ok) return { ok: false, field: 'name', message: name.message };
  const siteUrl = parseSiteUrl(input.siteUrl, opts);
  if (!siteUrl.ok) return { ok: false, field: 'siteUrl', message: siteUrl.message };
  return { ok: true, value: { name: name.value, siteUrl: siteUrl.value } };
}
