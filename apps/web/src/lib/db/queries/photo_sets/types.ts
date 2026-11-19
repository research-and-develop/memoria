/** At most this many sets per gallery (the add statement refuses the 51st). */
export const MAX_SETS = 50;

/** Mirrors `photo_sets` (plan p05 → Data). `photo_count` = ready, visible photos (D5.13). */
export type PhotoSetRow = {
  id: string;
  gallery_id: string;
  name: string;
  position: number;
  photo_count: number;
  created_at: string;
  updated_at: string;
};

/** No conversion needed: every column is already its JS type. */
export type PhotoSetDbRow = PhotoSetRow;

export const PHOTO_SET_COLUMNS = 'id, gallery_id, name, position, photo_count, created_at, updated_at';

export const toPhotoSetRow = (row: PhotoSetDbRow): PhotoSetRow => ({ ...row });
