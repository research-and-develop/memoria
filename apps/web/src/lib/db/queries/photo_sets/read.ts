import { allRows, firstRow, statement, type Options } from '@repo/db/client';

import { MAX_SETS, PHOTO_SET_COLUMNS, toPhotoSetRow, type PhotoSetDbRow, type PhotoSetRow } from './types';

/** A gallery's sets in order (ix_photo_sets_gallery_position); at most 50 exist. */
export function listSets(galleryId: string, opts?: Options): Promise<PhotoSetRow[]> {
  return allRows<PhotoSetDbRow, PhotoSetRow>(
    statement(`SELECT ${PHOTO_SET_COLUMNS} FROM photo_sets WHERE gallery_id = ? ORDER BY position, id LIMIT ?`, [galleryId, MAX_SETS]),
    toPhotoSetRow,
    opts,
  );
}

/** One set of this gallery; a set of another gallery reads as missing. */
export function getSet(input: { id: string; galleryId: string }, opts?: Options): Promise<PhotoSetRow | null> {
  return firstRow<PhotoSetDbRow, PhotoSetRow>(
    statement(`SELECT ${PHOTO_SET_COLUMNS} FROM photo_sets WHERE id = ? AND gallery_id = ?`, [input.id, input.galleryId]),
    toPhotoSetRow,
    opts,
  );
}
