import Link from 'next/link';

import { Text } from '@repo/ui/typography';

import type { RecoveryCodeStatus } from '@/lib/db/queries/admin_recovery_codes/types';

/** Pure: what the banner says, or null when nothing needs doing (D2.8). */
export function recoveryBannerMessage(status: RecoveryCodeStatus): string | null {
  if (status.total === 0) return null;
  if (status.unused === 0) return 'You have no recovery codes left. Generate new ones, or a lost phone locks you out.';
  if (status.unused <= 3) return `Only ${status.unused} recovery ${status.unused === 1 ? 'code is' : 'codes are'} left. Generate new ones.`;
  if (!status.acknowledged) return 'Did you save your recovery codes? Without them, a lost phone locks you out.';
  return null;
}

/** On the dashboard and Security: recovery codes not saved, running low or gone. Links to Security. */
export function RecoveryCodesBanner({ status, linked = true }: { status: RecoveryCodeStatus; linked?: boolean }) {
  const message = recoveryBannerMessage(status);
  if (!message) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface px-4 py-3">
      <Text as="p" size="body-sm" weight="semibold" tone="alert">
        {message}
      </Text>
      {linked ? (
        <Link href="/admin/settings/security#recovery-codes-title" className="inline-flex min-h-11 items-center font-sans text-body-sm font-semibold text-accent-ink underline-offset-4 hover:underline">
          Go to Security
        </Link>
      ) : null}
    </div>
  );
}
