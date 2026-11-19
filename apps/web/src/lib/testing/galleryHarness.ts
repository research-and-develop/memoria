import { batch, type Db } from '@repo/db/client';

import { markReadyStatement, insertUploadingPhotoStatement } from '@/lib/db/queries/photos';
import { photoUpload } from '@/lib/db/queries/galleries/testFixtures';
import { incrementSetCountsStatement, listSets } from '@/lib/db/queries/photo_sets';
import { coverDefaultStatement, galleryCountStatement } from '@/lib/db/queries/galleries';
import { createGallery } from '@/lib/galleries/galleries';
import { parseGalleryInput } from '@/lib/galleries/parseGalleryInput';
import { BRANDING_DEFAULTS } from '@/lib/settings/parseBrandingInput';
import { GALLERY_DEFAULTS } from '@/lib/settings/parseGalleryDefaultsInput';

/**
 * Test-only: a gallery made the way the route makes it, and ready photos in it (rows only; no
 * objects), with the counts and the cover default the complete batch would write.
 */
export async function makeGallery(db: Db, title = 'Shoot'): Promise<{ id: string; setId: string }> {
  const parsed = parseGalleryInput({ title, watermark: false }, { defaults: GALLERY_DEFAULTS, branding: BRANDING_DEFAULTS });
  if (!parsed.ok) throw new Error(parsed.message);
  const { id } = await createGallery(parsed.value, { db });
  const [set] = await listSets(id, { db });
  return { id, setId: set!.id };
}

export async function makeReadyPhotos(db: Db, galleryId: string, setId: string, count: number, over: Parameters<typeof photoUpload>[2] = {}): Promise<string[]> {
  const now = new Date().toISOString();
  const photos = Array.from({ length: count }, () => photoUpload(galleryId, setId, { now, ...over }));
  await batch(photos.map((p) => insertUploadingPhotoStatement(p)), { db });
  await batch(
    [
      ...photos.map((p) => markReadyStatement({ galleryId, id: p.id, batchNow: now })),
      incrementSetCountsStatement({ galleryId, setIds: [setId], photoIds: photos.map((p) => p.id), batchNow: now }),
      galleryCountStatement(galleryId),
      coverDefaultStatement(galleryId),
    ],
    { db },
  );
  return photos.map((p) => p.id);
}
