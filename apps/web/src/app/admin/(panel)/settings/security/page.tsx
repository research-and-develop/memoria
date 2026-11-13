import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { RecoveryCodesBanner } from '@/components/admin/RecoveryCodesBanner';
import { AuthenticatorsSection } from '@/components/admin/security/AuthenticatorsSection';
import { RecoveryCodesSection } from '@/components/admin/security/RecoveryCodesSection';
import { SecondFactorProvider } from '@/components/admin/security/SecondFactor';
import { SessionsSection, type SessionItem } from '@/components/admin/security/SessionsSection';
import { SignInSection, type SignInAccount } from '@/components/admin/security/SignInSection';
import { envPasswordStillSet } from '@/lib/auth/account';
import { getAdminAccount } from '@/lib/auth/account.cached';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { defaultAuthenticatorLabel, describeUserAgent } from '@/lib/auth/userAgent';
import { listAdminAuthenticatorSummaries } from '@/lib/db/queries/admin_authenticators';
import { getRecoveryCodeStatus } from '@/lib/db/queries/admin_recovery_codes';
import { listLiveAdminSessions } from '@/lib/db/queries/admin_sessions';
import { getStudio } from '@/lib/settings/studio.cached';

export const metadata: Metadata = { title: 'Security' };
export const dynamic = 'force-dynamic';

/** Settings → Security (plans p02, p02b): the sign-in email and password, authenticator apps, recovery codes, signed-in devices. */
export default async function SecurityPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const [apps, recovery, sessions, studio, account] = await Promise.all([
    listAdminAuthenticatorSummaries(),
    getRecoveryCodeStatus(),
    listLiveAdminSessions(new Date().toISOString()),
    getStudio(),
    getAdminAccount(),
  ]);
  if (!account) redirect('/admin/login');
  const signIn: SignInAccount = {
    email: account.email,
    installerPassword: account.setBy === 'cli',
    envPasswordStillSet: account.source === 'database' && envPasswordStillSet(),
  };
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
        <SignInSection account={signIn} />
        <AuthenticatorsSection
          apps={apps.map((a) => ({ id: a.id, label: a.label, createdAt: a.created_at, lastUsedAt: a.last_used_at }))}
          appName={studio.name}
          defaultLabel={defaultAuthenticatorLabel((await headers()).get('user-agent'))}
        />
        <RecoveryCodesSection status={recovery} appName={studio.name} />
        <SessionsSection sessions={sessionItems} />
      </div>
    </SecondFactorProvider>
  );
}
