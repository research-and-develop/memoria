import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { isUuid } from '@repo/core/validation';
import { Card, Pill } from '@repo/ui/layout';
import { Caption, Heading, Mono, Text } from '@repo/ui/typography';

import { PublishButton } from '@/components/admin/galleries/PublishButton';
import { PageHeader } from '@/components/admin/PageHeader';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { getGallery } from '@/lib/db/queries/galleries';
import { listSets } from '@/lib/db/queries/photo_sets';

export const metadata: Metadata = { title: 'Gallery' };
export const dynamic = 'force-dynamic';

/**
 * A gallery (plan p05): its status, address and sets. The manager's grid, upload, sharing and
 * delete arrive with commits 5–8; until then this page is where *Create gallery* lands.
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
            {gallery.purpose === 'selection' ? 'Selection' : 'Sharing'} · {gallery.photo_count} {gallery.photo_count === 1 ? 'photo' : 'photos'}
          </>
        }
        actions={
          <>
            <Pill tone={live ? 'live' : 'draft'}>{live ? 'Live' : 'Draft'}</Pill>
            <PublishButton galleryId={id} published={live} />
          </>
        }
      />
      <Card className="flex flex-col gap-2 p-5 sm:p-6">
        <Heading level={2} size="title">
          Address
        </Heading>
        <Mono size="body-sm" className="break-all">
          /g/{gallery.slug}
        </Mono>
        <Caption>{gallery.access === 'password' ? 'Clients need the password.' : 'Anyone with the link can open it once it is live.'}</Caption>
      </Card>
      <Card className="flex flex-col gap-2 p-5 sm:p-6">
        <Heading level={2} size="title">
          Sets
        </Heading>
        <ul className="flex flex-col gap-1">
          {sets.map((set) => (
            <li key={set.id}>
              <Text size="body-sm">
                {set.name} · {set.photo_count}
              </Text>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
