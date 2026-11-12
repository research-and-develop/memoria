'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@repo/ui/button';
import { DateText } from '@repo/ui/date';
import { useApi } from '@repo/ui/hooks/useApi';
import { Pill } from '@repo/ui/layout';
import { Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';

import { isSignedOut, useConfirmThen } from './SecondFactor';
import { SecuritySection } from './SecuritySection';

export type SessionItem = {
  id: string;
  device: string;
  country: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** "an authenticator app “iPhone”", "a removed app", "a recovery code". */
  signedInWith: string;
  current: boolean;
};

/** A country code as an English name ("BG" → "Bulgaria"); the code itself if unknown. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Settings → Security → Sessions: every signed-in device; sign out one, or all the others. */
export function SessionsSection({ sessions }: { sessions: SessionItem[] }) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [error, setError] = useState<string | null>(null);
  const others = useApi('/api/admin/sessions/sign-out-others', { method: 'POST' });
  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current));
  const hasOthers = sessions.some((s) => !s.current);

  const onSignOutOthers = async () => {
    setError(null);
    const result = await confirmThen(() => others.execute({}));
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (result.error) {
      if (result.error.errorCode !== 'CANCELLED') setError('Could not sign out the other devices. Please try again.');
      return;
    }
    router.refresh();
  };

  return (
    <SecuritySection
      id="sessions"
      title="Signed-in devices"
      description="A device stays signed in for 14 days without use, and at most 90 days."
      action={
        hasOthers ? (
          <Button variant="secondary" size="sm" loading={others.loading} onClick={onSignOutOthers}>
            Sign out all other devices
          </Button>
        ) : undefined
      }
    >
      <FormNote message={error} />
      <ul className="flex flex-col divide-y divide-line">
        {ordered.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </ul>
      {hasOthers ? null : (
        <Text as="p" size="body-sm" tone="muted">
          No other devices are signed in.
        </Text>
      )}
    </SecuritySection>
  );
}

function SessionRow({ session }: { session: SessionItem }) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [error, setError] = useState<string | null>(null);
  const signOut = useApi(`/api/admin/sessions/${session.id}`, { method: 'DELETE' });

  const onSignOut = async () => {
    setError(null);
    const result = await confirmThen(() => signOut.execute());
    if (session.current || isSignedOut(result)) {
      router.replace('/admin/login');
      router.refresh();
      return;
    }
    if (result.error) {
      if (result.error.errorCode !== 'CANCELLED') setError('Could not sign it out. Please try again.');
      return;
    }
    router.refresh();
  };

  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <Text weight="semibold">{session.device}</Text>
          {session.current ? (
            <Pill tone="accent" size="sm">
              This device
            </Pill>
          ) : null}
        </span>
        <Text size="caption" tone="muted">
          {session.country ? `${countryName(session.country)} · ` : ''}signed in <DateText value={session.createdAt} pattern="d MMM yyyy" /> with{' '}
          {session.signedInWith} · last active <DateText value={session.lastSeenAt} fromNow />
        </Text>
        {error ? (
          <Text as="p" size="caption" tone="danger" role="alert">
            {error}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <Button size="sm" variant="ghost" loading={signOut.loading} onClick={onSignOut} aria-label={session.current ? 'Sign out this device' : `Sign out ${session.device}`}>
          Sign out
        </Button>
        {session.current ? (
          <Text size="caption" tone="muted">
            Ends this page
          </Text>
        ) : null}
      </div>
    </li>
  );
}
