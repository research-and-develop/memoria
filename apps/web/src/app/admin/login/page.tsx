import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getPlatform } from '@repo/platform/current';
import { Card, Section } from '@repo/ui/layout';
import { Text } from '@repo/ui/typography';

import { CodeForm } from '@/components/admin/login/CodeForm';
import { EnrollForm } from '@/components/admin/login/EnrollForm';
import { safeNext } from '@/components/admin/login/loginFlash';
import { SetupCodeForm } from '@/components/admin/login/SetupCodeForm';
import { StartOver } from '@/components/admin/login/StartOver';
import { StepHeading } from '@/components/admin/login/StepHeading';
import { LoginForm } from '@/components/admin/LoginForm';
import { challengeCookieName, loadSignInChallenge } from '@/lib/auth/challenge';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { pendingSecret } from '@/lib/auth/secondFactor';
import { SIGN_IN_MESSAGES } from '@/lib/auth/signInMessages';
import { otpauthUri } from '@/lib/auth/totp';
import { twoFactorKeys } from '@/lib/auth/twoFactorKeys';
import { defaultAuthenticatorLabel } from '@/lib/auth/userAgent';
import { isSecureRequest } from '@/lib/security/request';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/**
 * The sign-in page. Each step is a server render: the challenge cookie says
 * which (none → the password; 'login' → a code; 'enroll' → the setup code,
 * then the QR code). The forms call `router.refresh()` to move on.
 */
export default async function AdminLoginPage({ searchParams }: Props) {
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  if (await getAdminSession()) redirect(next);
  return (
    <main>
      <Section surface="ground" className="min-h-screen">
        <Card className="mx-auto flex max-w-md flex-col gap-6 rounded-panel p-6 sm:p-8">
          <Step next={next} />
        </Card>
      </Section>
    </main>
  );
}

async function Step({ next }: { next: string }) {
  const config = getPlatform().config();
  const h = await headers();
  const token = (await cookies()).get(challengeCookieName(isSecureRequest(h)))?.value;
  const loaded = await loadSignInChallenge(token, { passwordHash: config.admin.passwordHash, now: new Date() });
  if (loaded.status !== 'live') return <LoginForm />;

  const { challenge } = loaded;
  if (challenge.kind === 'login') return <CodeForm next={next} />;
  if (!challenge.setup_code_id) return <SetupCodeForm />;

  const secret = config.admin.totpKey ? await pendingSecret(challenge, await twoFactorKeys(config.admin.totpKey)) : null;
  if (!secret) {
    return (
      <div className="flex flex-col gap-4">
        <StepHeading>Set up two-factor</StepHeading>
        <Text as="p" size="body-sm" tone="danger">
          {SIGN_IN_MESSAGES.TWO_FACTOR_NOT_CONFIGURED}
        </Text>
        <StartOver />
      </div>
    );
  }
  return (
    <EnrollForm
      secret={secret}
      otpauthUri={otpauthUri({ issuer: config.appName, account: config.admin.email, secret })}
      defaultLabel={defaultAuthenticatorLabel(h.get('user-agent'))}
      appName={config.appName}
      next={next}
    />
  );
}
