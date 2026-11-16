import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getPlatform } from '@repo/platform/current';

import { SecondFactorProvider } from '@/components/admin/security/SecondFactor';
import { MailProviderForm } from '@/components/admin/settings/emails/MailProviderForm';
import { RecentEmails } from '@/components/admin/settings/emails/RecentEmails';
import { SecurityNoticesToggle } from '@/components/admin/settings/emails/SecurityNoticesToggle';
import { TestEmailForm } from '@/components/admin/settings/emails/TestEmailForm';
import { getAdminAccount } from '@/lib/auth/account.cached';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { emailsNotSending, recentEmails } from '@/lib/email/admin';
import { isMailConfigured, readMailSettings } from '@/lib/settings/mail';
import { toMailSettingsView } from '@/lib/settings/parseMailSettings';
import { readSecurityNoticesEnabled } from '@/lib/settings/securityNotices';
import { getStudio } from '@/lib/settings/studio.cached';

export const metadata: Metadata = { title: 'Emails' };
export const dynamic = 'force-dynamic';

/** Settings → Emails (plan p03, D3.12): how email is sent, a test email, security emails, recent emails. */
export default async function EmailSettingsPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const [saved, configured, noticesOn, emails, notSending, studio, account] = await Promise.all([
    readMailSettings(),
    isMailConfigured(),
    readSecurityNoticesEnabled(),
    recentEmails(),
    emailsNotSending(new Date()),
    getStudio(),
    getAdminAccount(),
  ]);
  const canSave = getPlatform().config().settingsKey !== null;
  return (
    <SecondFactorProvider>
      <div className="flex flex-col gap-5">
        <MailProviderForm saved={saved ? toMailSettingsView(saved) : null} usingEnvFallback={!saved && configured} canSave={canSave} studioName={studio.name} />
        <TestEmailForm defaultTo={account?.email ?? ''} configured={configured} />
        <SecurityNoticesToggle enabled={noticesOn} configured={configured} />
        <RecentEmails emails={emails} notSending={notSending} />
      </div>
    </SecondFactorProvider>
  );
}
