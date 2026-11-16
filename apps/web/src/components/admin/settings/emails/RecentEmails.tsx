'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@repo/ui/button';
import { DateText } from '@repo/ui/date';
import { useApi } from '@repo/ui/hooks/useApi';
import { Pill, type PillTone } from '@repo/ui/layout';
import { Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';
import { isSignedOut } from '@/components/admin/security/SecondFactor';
import { EMAIL_STATUS_LABELS, errorSentence, type EmailStatus, type EmailView } from '@/lib/email/views';

import { SettingsCard } from '../SettingsCard';

const TONE: Record<EmailStatus, PillTone> = { queued: 'neutral', sending: 'accent', sent: 'live', retrying: 'scheduled', failed: 'alert' };

/** Settings → Emails → Recent emails: the last 20, their status and reason; Retry on a failed one. */
export function RecentEmails({ emails, notSending }: { emails: EmailView[]; notSending: boolean }) {
  return (
    <SettingsCard id="recent-emails" title="Recent emails" description="The last 20 emails your studio sent or tried to send. They are kept for 30 days.">
      {notSending ? <FormNote message="Emails are not being sent: the background worker is not running." /> : null}
      {emails.length === 0 ? (
        <Text as="p" size="body-sm" tone="muted">
          No emails yet.
        </Text>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {emails.map((email) => (
            <EmailRow key={email.id} email={email} />
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function EmailRow({ email }: { email: EmailView }) {
  const reason = errorSentence(email.lastError);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Text as="span" size="body-sm" weight="semibold">
            {email.templateLabel}
          </Text>
          <Pill tone={TONE[email.status]} size="sm">
            {EMAIL_STATUS_LABELS[email.status]}
          </Pill>
        </div>
        <Text as="p" size="caption" tone="muted" className="break-all">
          To {email.to} · <DateText value={email.createdAt} pattern="d MMM yyyy, HH:mm" />
        </Text>
        {email.lastError && (email.status === 'failed' || email.status === 'retrying') ? (
          <Text as="p" size="caption" tone="muted" className="break-words">
            {reason ? `${reason} ` : ''}({email.lastError})
          </Text>
        ) : null}
        {email.status === 'retrying' && email.nextAttemptAt ? (
          <Text as="p" size="caption" tone="muted">
            Next try <DateText value={email.nextAttemptAt} pattern="d MMM, HH:mm" />
          </Text>
        ) : null}
      </div>
      {email.canRetry ? <RetryEmailButton id={email.id} /> : null}
    </li>
  );
}

export function RetryEmailButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { execute, loading } = useApi(`/api/admin/emails/${id}/retry`, { method: 'POST' });
  const onRetry = async () => {
    setError(null);
    const result = await execute({});
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (result.error) {
      if (result.error.errorCode === 'ABORT_ERROR') return;
      const message = result.error.details?.message;
      return setError(typeof message === 'string' ? message : 'Could not retry it. Please try again.');
    }
    router.refresh();
  };
  return (
    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <Button variant="secondary" size="sm" loading={loading} onClick={onRetry}>
        Retry
      </Button>
      <FormNote message={error} />
    </div>
  );
}
