import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { NewGalleryForm } from '@/components/admin/galleries/NewGalleryForm';
import { PageHeader } from '@/components/admin/PageHeader';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { getBranding } from '@/lib/settings/branding.cached';
import { getGalleryDefaults } from '@/lib/settings/galleryDefaults.cached';
import { getWatermark } from '@/lib/settings/watermark.cached';

export const metadata: Metadata = { title: 'New gallery' };
export const dynamic = 'force-dynamic';

const WATERMARK_LABEL = { none: 'No watermark', image: 'Your image watermark', text: 'Your text watermark' } as const;

/** New gallery (plan p05 T5.3): starts from the studio's defaults and branding (Phase 4). */
export default async function NewGalleryPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const [defaults, branding, watermark] = await Promise.all([getGalleryDefaults(), getBranding(), getWatermark()]);
  return (
    <div className="flex flex-col gap-7">
      <PageHeader title="New gallery" description="Set it up once; upload photos next." />
      <NewGalleryForm defaults={defaults} branding={branding} watermark={{ kind: watermark.kind, label: WATERMARK_LABEL[watermark.kind] }} />
    </div>
  );
}
