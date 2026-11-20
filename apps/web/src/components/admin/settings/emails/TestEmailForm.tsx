'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';
import { Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';
import { isSignedOut } from '@/components/admin/security/SecondFactor';
import { EMAIL_STATUS_LABELS, errorSentence, type EmailView } from '@/lib/email/views';

import { SettingsCard } from '../SettingsCard';

export const POLL_MS = 2_000;
export const GIVE_UP_MS = 60_000;

/** Settings → Emails → Test email: send one, then follow it live until it is sent or fails. */
export function TestEmailForm({ defaultTo, configured }: { defaultTo: string; configured: boolean }) {
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<EmailView | null>(null);
  const router = useRouter();
  const { execute, loading } = useApi<EmailView>('/api/admin/emails/test', { method: 'POST' });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await execute({ to });
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (result.error || !result.data) {
      if (result.error?.errorCode === 'ABORT_ERROR') return;
      const message = result.error?.details?.message;
      return setError(typeof message === 'string' ? message : 'Could not send the test email. Please try again.');
    }
    setSent(result.data);
  };

  return (
    <SettingsCard id="test-email" title="Test email" description="Send yourself an email to check that sending works.">
      <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
        <FormNote message={error} />
        <FormField label="Send to">
          {(ids) => <Input {...ids} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={to} onChange={(e) => setTo(e.target.value)} />}
        </FormField>
        <div>
          <Button type="submit" variant="secondary" loading={loading} disabled={!configured}>
            Send test email
          </Button>
        </div>
        {!configured ? (
          <Text as="p" size="body-sm" tone="muted">
            Save how to send email first.
          </Text>
        ) : null}
      </form>
      {sent ? <EmailStatusLine key={sent.id} initial={sent} /> : null}
    </SettingsCard>
  );
}

/**
 * The live status of one email: polls every 2 s until it is sent or failed, the session ends, it
 * is gone, or a minute passes (then: is the relay running?). A network error keeps trying.
 */
export function EmailStatusLine({ initial, sentNote = 'Check the inbox.' }: { initial: EmailView; sentNote?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initial);
  const [stopped, setStopped] = useState<null | 'final' | 'timeout' | 'signed-out' | 'gone'>(null);
  const [tick, setTick] = useState(0);
  const { execute } = useApi<EmailView>(`/api/admin/emails/${initial.id}`);
  const started = useRef(Date.now());

  useEffect(() => {
    if (stopped) return;
    const timer = setTimeout(async () => {
      const result = await execute();
      if (result.error?.errorCode === 'ABORT_ERROR') return;
      if (isSignedOut(result)) return setStopped('signed-out');
      if (result.error?.errorCode === 'NOT_FOUND') return setStopped('gone');
      if (result.data) {
        setEmail(result.data);
        if (result.data.status === 'sent' || result.data.status === 'failed') {
          setStopped('final');
          router.refresh();
          return;
        }
      }
      if (Date.now() - started.current >= GIVE_UP_MS) setStopped('timeout');
      else setTick((t) => t + 1); // the next poll
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [tick, stopped, execute, router]);

  const reason = email.status === 'failed' ? (errorSentence(email.lastError) ?? email.lastError) : null;
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1">
      <Text as="p" size="body-sm" weight="semibold">
        {EMAIL_STATUS_LABELS[email.status]}
        {reason ? `: ${reason}` : email.status === 'sent' ? `. ${sentNote}` : '…'}
      </Text>
      {email.status === 'failed' && email.lastError && reason !== email.lastError ? (
        <Text as="p" size="caption" tone="muted" className="break-words">
          {email.lastError}
        </Text>
      ) : null}
      {stopped === 'timeout' ? (
        <Text as="p" size="body-sm" tone="muted">
          Still queued: the background worker has not picked it up. Is it deployed and running?
        </Text>
      ) : null}
      {stopped === 'signed-out' ? (
        <Text as="p" size="body-sm" tone="muted">
          You were signed out. Sign in again to see what happened.
        </Text>
      ) : null}
    </div>
  );
}
