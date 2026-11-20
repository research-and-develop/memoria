import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { isUuid } from '@repo/core/validation';
import { Pill } from '@repo/ui/layout';
import { Mono } from '@repo/ui/typography';

import { GalleryManager } from '@/components/admin/galleries/GalleryManager';
import { PublishButton } from '@/components/admin/galleries/PublishButton';
import { ShareButton } from '@/components/admin/galleries/SharingPanel';
import { ViewAsClientButton } from '@/components/admin/galleries/ViewAsClientButton';
import { PageHeader } from '@/components/admin/PageHeader';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { getGallery } from '@/lib/db/queries/galleries';
import { listSets } from '@/lib/db/queries/photo_sets';
import { gallerySettingsOf, galleryView } from '@/lib/galleries/galleries';
import { getStudio } from '@/lib/settings/studio.cached';

export const metadata: Metadata = { title: 'Gallery' };
export const dynamic = 'force-dynamic';

/**
 * The gallery manager (plan p05 → Screens): the header (title, status, counts, the address, Publish)
 * *View as client* (p06 D6.11) and the manager itself, which renders its photos in the browser from
 * the API (D5.14). *Share* opens the sharing panel (link, QR, password, the client email).
 */
export default async function GalleryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const gallery = await getGallery(id);
  if (!gallery || gallery.deleted_at) notFound();
  const [sets, studio] = await Promise.all([listSets(id), getStudio()]);
  const view = await galleryView({ ...gallery, settingsParsed: gallerySettingsOf(gallery), sets });
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
            <ViewAsClientButton galleryId={id} />
            <PublishButton galleryId={id} published={live} />
            <ShareButton
              siteUrl={studio.siteUrl}
              gallery={{
                id,
                slug: gallery.slug,
                published: live,
                access: gallery.access,
                clientName: gallery.client_name,
                clientEmail: gallery.client_email,
                unfinished: view.unfinishedUploads,
              }}
            />
          </>
        }
      />
      <GalleryManager
        title={gallery.title}
        initial={{
          id,
          coverPhotoId: gallery.cover_photo_id,
          sort: view.settings.sort,
          sets: sets.map((s) => ({ id: s.id, name: s.name, photoCount: s.photo_count })),
          upload: { processing: view.processing, watermark: view.watermark, imageUrl: view.imageUrl },
          unfinishedUploads: view.unfinishedUploads,
        }}
      />
    </div>
  );
}
