'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useApi } from '@repo/ui/hooks/useApi';
import { Toggle } from '@repo/ui/toggle';

import { FormNote } from '@/components/admin/login/StepHeading';
import { isSignedOut, useConfirmThen } from '@/components/admin/security/SecondFactor';

import { SettingsCard } from '../SettingsCard';

/**
 * Settings → Emails → Security notices (plan p03, D3.19): emails to the sign-in address about
 * sign-ins and security changes. Turning them off asks for a code and sends one last notice.
 */
export function SecurityNoticesToggle({ enabled, configured }: { enabled: boolean; configured: boolean }) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const { execute, loading } = useApi<{ enabled: boolean }>('/api/admin/settings/security-notices', { method: 'PUT' });

  const onChange = async (next: boolean) => {
    setError(null);
    const result = await confirmThen(() => execute({ enabled: next }));
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (result.error || !result.data) {
      if (result.error?.errorCode !== 'CANCELLED' && result.error?.errorCode !== 'ABORT_ERROR') setError('Could not change it. Please try again.');
      return;
    }
    setOn(result.data.enabled);
    router.refresh();
  };

  return (
    <SettingsCard
      id="security-notices"
      title="Security emails"
      description={configured ? 'Sent to your sign-in email. They never contain a code or a password.' : 'They start once email is set up above.'}
    >
      <FormNote message={error} />
      <Toggle
        checked={on}
        disabled={loading}
        onCheckedChange={onChange}
        label="Email me about sign-ins and security changes"
        description="A new sign-in, an authenticator added or removed, new recovery codes, a changed email, password or email settings, and a locked sign-in."
      />
    </SettingsCard>
  );
}
