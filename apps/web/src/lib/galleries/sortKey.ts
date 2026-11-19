/**
 * Photo order (plan p05, D5.23). Pure. The database composes the stored `sort_key` itself (in the
 * register INSERT, the re-mint and the re-sort, from the gallery's current sort); `sortKey` here is
 * the reference the tests hold the SQL to, and what a cursor is made of.
 */

/** `name_key` is cut to this length AFTER padding, so a digit-heavy name cannot grow it. */
export const NAME_KEY_MAX = 120;
/** A cursor (base64url of a `sort_key`) longer than this is refused (Phase 6 uses the same cap). */
export const CURSOR_MAX = 700;
/** `taken_key` of a photo without a capture time: after every date. */
export const NO_TAKEN = '~';

/**
 * The natural-order form of a filename: lower-cased, NFKD with the combining marks removed (so `é`
 * sorts with `e`), every run of digits zero-padded to 10 (`IMG_9` before `IMG_10`), then ≤ 120.
 */
export function nameKey(filename: string): string {
  const folded = filename.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
  return folded.replace(/\d+/g, (digits) => digits.padStart(10, '0')).slice(0, NAME_KEY_MAX);
}

/** `YYYY-MM-DDTHH:MM:SS` (EXIF wall-clock, no zone) or `~`. */
export function takenKey(takenAt: string | null): string {
  return takenAt ?? NO_TAKEN;
}

export function sortKey(sort: 'filename' | 'taken', name: string, taken: string, id: string): string {
  return sort === 'taken' ? `${taken}|${name}|${id}` : `${name}|${taken}|${id}`;
}

/** The cursor of a page: base64url of the last `sort_key`. */
export function encodeCursor(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The `sort_key` a cursor names, or null when it is malformed or over 700 characters (→ 400). */
export function decodeCursor(cursor: string): string | null {
  if (cursor.length === 0 || cursor.length > CURSOR_MAX || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cursor.length % 4)) % 4));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}
