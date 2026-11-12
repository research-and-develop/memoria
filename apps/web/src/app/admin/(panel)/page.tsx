import { Text } from '@repo/ui/typography';

import { PageHeader } from '@/components/admin/PageHeader';
import { RecoveryCodesBanner } from '@/components/admin/RecoveryCodesBanner';
import { getRecoveryCodeStatus } from '@/lib/db/queries/admin_recovery_codes';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/** The admin dashboard: a placeholder until Phase 11 fills it. */
export default async function AdminDashboardPage() {
  const recovery = await getRecoveryCodeStatus();
  return (
    <div className="flex flex-col gap-7">
      <PageHeader title="Dashboard" />
      <RecoveryCodesBanner status={recovery} />
      <Text as="p" tone="muted">
        Nothing here yet: galleries, selections and visitor numbers arrive with the phases that build them.
      </Text>
    </div>
  );
}
