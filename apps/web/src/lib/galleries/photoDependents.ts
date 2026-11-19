import type { Statement } from '@repo/platform/ports';

/**
 * Hooks for the tables that will reference photos (plan p05, D5.24). Empty in Phase 5; Phase 7
 * registers its tables (favourites, comments, retouch requests) here.
 *
 * - `PHOTO_DEPENDENT_DELETES`: each builds the DELETE of the rows that reference these photos; every
 *   purge runs them BEFORE it deletes photo rows (no FK cascades: D5.18).
 * - `photoChangeGuard`: bulk move/hide/delete call it first; Phase 7 makes it refuse (409) a photo in
 *   a submitted, locked selection.
 *
 * Relay-safe (the purges run there): no imports but types.
 */
export const PHOTO_DEPENDENT_DELETES: ((photoIds: readonly string[]) => Statement)[] = [];

export type PhotoChange = 'move' | 'hide' | 'show' | 'delete';

export async function photoChangeGuard(galleryId: string, photoIds: readonly string[], action: PhotoChange): Promise<void> {
  void galleryId;
  void photoIds;
  void action;
}
