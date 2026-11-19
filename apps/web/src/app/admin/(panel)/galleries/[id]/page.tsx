import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { isUuid } from '@repo/core/validation';
import { Pill } from '@repo/ui/layout';
import { Mono } from '@repo/ui/typography';

import { GalleryManager } from '@/components/admin/galleries/GalleryManager';
import { PublishButton } from '@/components/admin/galleries/PublishButton';
import { PageHeader } from '@/components/admin/PageHeader';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { getGallery } from '@/lib/db/queries/galleries';
import { listSets } from '@/lib/db/queries/photo_sets';
import { gallerySettingsOf } from '@/lib/galleries/galleries';

export const metadata: Metadata = { title: 'Gallery' };
export const dynamic = 'force-dynamic';

/**
 * The gallery manager (plan p05 → Screens): the header (title, status, counts, the address, Publish)
 * and the manager itself, which renders its photos in the browser from the API (D5.14). *Share* and
 * *View as client* arrive with commit 7 and Phase 6 T6.4.
 */
export default async function GalleryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const gallery = await getGallery(id);
  if (!gallery || gallery.deleted_at) notFound();
  const sets = await listSets(id);
  const live = gallery.status === 'published';
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title={gallery.title}
        description={
          <>
            {gallery.purpose === 'selection' ? 'Selection' : 'Sharing'} · {gallery.photo_count} {gallery.photo_count === 1 ? 'photo' : 'photos'} ·{' '}
            <Mono size="caption" className="break-all">
              /g/{gallery.slug}
            </Mono>
          </>
        }
        actions={
          <>
            <Pill tone={live ? 'live' : 'draft'}>{live ? 'Live' : 'Draft'}</Pill>
            <PublishButton galleryId={id} published={live} />
          </>
        }
      />
      <GalleryManager
        initial={{
          id,
          coverPhotoId: gallery.cover_photo_id,
          sort: gallerySettingsOf(gallery).sort,
          sets: sets.map((s) => ({ id: s.id, name: s.name, photoCount: s.photo_count })),
        }}
      />
    </div>
  );
}
