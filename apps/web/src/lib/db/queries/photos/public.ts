import { statement } from '@repo/db/statement';
import type { Statement } from '@repo/platform/ports';

import type { DerivativeExt } from './types';

/**
 * The public read of this table (plan p06 D6.6, D6.8): one page of a set's photos for the client
 * gallery, in the gallery's order (`sort_key`, Phase 5 D5.23), through `ix_photos_set_order (set_id,
 * sort_key)` with `hidden` and `status` filtered on the row. EDGE-SAFE (only `@repo/db/statement` and
 * type imports); imported BY PATH, never through the barrel. Guard: `edge-graph`.
 *
 * - The join on `photo_sets … AND s.gallery_id = ?` makes a set of ANOTHER gallery return nothing, so
 *   the caller answers 404 even on a cache miss.
 * - The cursor is the last `sort_key` of the previous page (unique per photo); the first page passes `''`.
 * - It selects only what a client sees: the display copy's size, the placeholder colour, `rev` and the
 *   extension (the browser builds the public URLs from them). Never a filename, never an original.
 * - It reads `limit` rows: pass `PUBLIC_PHOTO_PAGE + 1` to learn whether a next page exists.
 */
export const PUBLIC_PHOTO_PAGE = 500;

export type PublicPhotoRow = { id: string; w: number; h: number; color: string; rev: string; ext: DerivativeExt; sort_key: string };

export function publicPhotosStatement(galleryId: string, setId: string, afterSortKey: string, limit = PUBLIC_PHOTO_PAGE + 1): Statement {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), PUBLIC_PHOTO_PAGE + 1);
  return statement(
    `SELECT p.id, p.display_width AS w, p.display_height AS h, p.color, p.rev, p.derivative_ext AS ext, p.sort_key
     FROM photos p
     JOIN photo_sets s ON s.id = p.set_id AND s.gallery_id = ?
     WHERE p.set_id = ? AND p.sort_key > ? AND p.hidden = 0 AND p.status = 'ready'
     ORDER BY p.sort_key
     LIMIT ?`,
    [galleryId, setId, afterSortKey, bounded],
  );
}
