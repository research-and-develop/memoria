import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getPlatform } from '@repo/platform/current';

import { SecondFactorProvider } from '@/components/admin/security/SecondFactor';
import { StudioSection } from '@/components/admin/settings/StudioSection';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { studioDefaults } from '@/lib/settings/studio';
import { getStudio } from '@/lib/settings/studio.cached';

export const metadata: Metadata = { title: 'Studio' };
export const dynamic = 'force-dynamic';

/** Settings → Studio (plan p02b): the studio name and the website address. */
export default async function StudioSettingsPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const studio = await getStudio();
  return (
    <SecondFactorProvider>
      <StudioSection studio={studio} defaultSiteUrl={studioDefaults().siteUrl} isDevelopment={getPlatform().config().isDevelopment} />
    </SecondFactorProvider>
  );
}
