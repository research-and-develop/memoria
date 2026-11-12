import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getPlatform } from '@repo/platform/current';
import { Mono, Text } from '@repo/ui/typography';

import { RecoveryCodesBanner } from '@/components/admin/RecoveryCodesBanner';
import { AuthenticatorsSection } from '@/components/admin/security/AuthenticatorsSection';
import { RecoveryCodesSection } from '@/components/admin/security/RecoveryCodesSection';
import { SecondFactorProvider } from '@/components/admin/security/SecondFactor';
import { SecuritySection } from '@/components/admin/security/SecuritySection';
import { SessionsSection, type SessionItem } from '@/components/admin/security/SessionsSection';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { defaultAuthenticatorLabel, describeUserAgent } from '@/lib/auth/userAgent';
import { listAdminAuthenticatorSummaries } from '@/lib/db/queries/admin_authenticators';
import { getRecoveryCodeStatus } from '@/lib/db/queries/admin_recovery_codes';
import { listLiveAdminSessions } from '@/lib/db/queries/admin_sessions';

export const metadata: Metadata = { title: 'Security' };
export const dynamic = 'force-dynamic';

/** Settings → Security (plan p02): authenticator apps, recovery codes, signed-in devices, the password. */
export default async function SecurityPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const config = getPlatform().config();
  const [apps, recovery, sessions] = await Promise.all([
    listAdminAuthenticatorSummaries(),
    getRecoveryCodeStatus(),
    listLiveAdminSessions(new Date().toISOString()),
  ]);
  const labels = new Map(apps.map((a) => [a.id, a.label]));
  const sessionItems: SessionItem[] = sessions.map((s) => ({
    id: s.id,
    device: describeUserAgent(s.user_agent),
    country: s.country,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    signedInWith:
      s.second_factor === 'recovery_code'
        ? 'a recovery code'
        : s.authenticator_id && labels.has(s.authenticator_id)
          ? `the app “${labels.get(s.authenticator_id)}”`
          : 'a removed app',
    current: s.id === session.sessionId,
  }));

  return (
    <SecondFactorProvider>
      <div className="flex flex-col gap-5">
        <RecoveryCodesBanner status={recovery} linked={false} />
        <AuthenticatorsSection
          apps={apps.map((a) => ({ id: a.id, label: a.label, createdAt: a.created_at, lastUsedAt: a.last_used_at }))}
          appName={config.appName}
          defaultLabel={defaultAuthenticatorLabel((await headers()).get('user-agent'))}
        />
        <RecoveryCodesSection status={recovery} appName={config.appName} />
        <SessionsSection sessions={sessionItems} />
        <SecuritySection id="password" title="Password" description="To change your password, see the deployment guide. Changing it signs out every device.">
          <details className="font-sans text-body-sm text-ink-2">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">How the developer changes it</summary>
            <div className="flex flex-col gap-2 pt-1">
              <Text as="p" size="body-sm" tone="ink2">
                Make a new hash, then store it as the secret (in <Mono size="body-sm">apps/web</Mono>):
              </Text>
              <Mono as="pre" size="body-sm" className="overflow-x-auto rounded-control bg-wash px-3 py-2">
                {'npm run admin:hash-password\nnpx wrangler secret put ADMIN_PASSWORD_HASH'}
              </Mono>
            </div>
          </details>
        </SecuritySection>
      </div>
    </SecondFactorProvider>
  );
}
