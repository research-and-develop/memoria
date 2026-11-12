import Link from 'next/link';

import { buttonClassName } from '@repo/ui/button';
import { Text } from '@repo/ui/typography';

import { PageHeader } from '@/components/admin/PageHeader';

export const metadata = { title: 'Dashboard' };

/** The admin dashboard: a placeholder until Phase 11 fills it. */
export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Dashboard"
        actions={
          <Link href="/admin/design" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
            Design system
          </Link>
        }
      />
      <Text as="p" tone="muted">
        Nothing here yet: galleries, selections and visitor numbers arrive with the phases that build them.
      </Text>
    </div>
  );
}
