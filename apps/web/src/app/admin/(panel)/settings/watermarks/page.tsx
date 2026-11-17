import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { WatermarksSection } from '@/components/admin/settings/watermarks/WatermarksSection';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { canUseImageWatermark, watermarkView } from '@/lib/settings/watermark';
import { getWatermark } from '@/lib/settings/watermark.cached';

export const metadata: Metadata = { title: 'Watermarks' };
export const dynamic = 'force-dynamic';

/** Settings → Watermarks (plan p04 D4.9): the watermark baked into selection galleries' previews. */
export default async function WatermarksSettingsPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const { watermark, imageUrl } = await watermarkView(await getWatermark());
  return <WatermarksSection initial={watermark} imageUrl={imageUrl} canUseImage={canUseImageWatermark()} />;
}
