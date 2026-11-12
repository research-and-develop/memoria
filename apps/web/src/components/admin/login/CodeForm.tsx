'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { Text } from '@repo/ui/typography';

import { cleanDigits, CodeField } from './CodeField';
import { forgetLoginEmail, safeNext, setLoginNote } from './loginFlash';
import { StartOver } from './StartOver';
import { FormNote, StepHeading } from './StepHeading';
import { stepErrorOutcome } from './stepError';

type Verified = { expiresAt: string; recoveryCodesLeft?: number };

/**
 * Sign-in step 2: a 6-digit code from an authenticator app, or a recovery
 * code. Submits by itself at the sixth digit; one request at a time.
 */
export function CodeForm({ next }: { next?: string }) {
  const router = useRouter();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { execute, loading } = useApi<Verified>('/api/admin/login/verify', { method: 'POST' });
  const busy = useRef(false);

  const submit = async (input: string) => {
    if (busy.current) return;
    if (!input.trim()) {
      setError(recovery ? 'Enter a recovery code.' : 'Enter the 6-digit code.');
      return;
    }
    busy.current = true;
    setError(null);
    const result = await execute(recovery ? { recoveryCode: input } : { code: input });
    busy.current = false;
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
    forgetLoginEmail();
    router.replace(safeNext(next));
    router.refresh();
  };

  const onChange = (raw: string) => {
    if (recovery) {
      setValue(raw);
      return;
    }
    const digits = cleanDigits(raw);
    setValue(digits);
    if (digits.length === 6 && digits !== value) void submit(digits);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(value);
  };

  const switchMode = () => {
    setRecovery((r) => !r);
    setValue('');
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <StepHeading>Enter your code</StepHeading>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormNote message={error} />
        <CodeField
          ref={inputRef}
          label={recovery ? 'Recovery code' : 'Code from your authenticator app'}
          hint={recovery ? 'One of the codes you saved when you set up two-factor, like k7xqd-m2pw4.' : 'Codes change every 30 seconds.'}
          value={value}
          onChange={onChange}
          digits={!recovery}
        />
        <Button type="submit" variant="primary" loading={loading} className="w-full">
          {recovery ? 'Sign in with recovery code' : 'Sign in'}
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Button variant="link" className="min-h-11 text-body-sm" onClick={switchMode}>
          {recovery ? 'Use a code from your app' : 'Use a recovery code'}
        </Button>
        <StartOver />
      </div>
      <Text as="p" size="caption" tone="muted">
        Lost your phone and your recovery codes? The developer can reset two-factor sign-in.
      </Text>
    </div>
  );
}
