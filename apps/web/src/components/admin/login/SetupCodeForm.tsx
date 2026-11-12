'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { Mono, Text } from '@repo/ui/typography';

import { CodeField } from './CodeField';
import { setLoginNote } from './loginFlash';
import { StartOver } from './StartOver';
import { FormNote, StepHeading } from './StepHeading';
import { stepErrorOutcome } from './stepError';

/**
 * First sign-in, step 2: the one-time setup code the developer printed with
 * `npm run admin:mfa -- setup`. Right: the page shows the QR code.
 */
export function SetupCodeForm() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { execute, loading } = useApi('/api/admin/login/setup', { method: 'POST' });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!value.trim()) {
      setError('Enter the setup code.');
      return;
    }
    setError(null);
    const result = await execute({ setupCode: value });
    if (result.error) {
      const outcome = stepErrorOutcome(result.error);
      if (outcome.kind === 'restart') {
        setLoginNote(outcome.note);
        router.refresh();
      } else if (outcome.kind === 'show') {
        setError(outcome.message);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <StepHeading>Set up two-factor</StepHeading>
      <Text as="p" size="body-sm" tone="ink2">
        Signing in needs a code from an authenticator app on your phone. To connect the first one, enter the setup code printed by{' '}
        <Mono size="body-sm">npm run admin:mfa -- setup</Mono>.
      </Text>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormNote message={error} />
        <CodeField ref={inputRef} label="Setup code" hint="20 letters and digits; dashes and spaces are fine." value={value} onChange={setValue} digits={false} />
        <Button type="submit" variant="primary" loading={loading} className="w-full">
          Continue
        </Button>
      </form>
      <div className="flex justify-end">
        <StartOver />
      </div>
    </div>
  );
}
