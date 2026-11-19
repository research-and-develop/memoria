import { statement } from '@repo/db/statement';
import type { Statement } from '@repo/platform/ports';

import { MAX_SETS } from './types';

/**
 * The public read of this table (plan p06 D6.6, D6.8): a gallery's sets in their order, for the
 * client's tabs, through `ix_photo_sets_gallery_position`, bounded by `MAX_SETS`. EDGE-SAFE (only
 * `@repo/db/statement`, the import-free `./types` and type imports); imported BY PATH, never through
 * the barrel. Guard: `edge-graph`. `photo_count` = ready, visible photos (Phase 5 D5.13).
 */
export type PublicSetRow = { id: string; name: string; photo_count: number };

export function publicSetsStatement(galleryId: string): Statement {
  return statement('SELECT id, name, photo_count FROM photo_sets WHERE gallery_id = ? ORDER BY position LIMIT ?', [galleryId, MAX_SETS]);
}
