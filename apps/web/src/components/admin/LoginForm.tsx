'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';

import { Turnstile, type TurnstileHandle } from '@/components/forms/Turnstile';
import { parseLoginInput } from '@/lib/auth/parseLoginInput';

import { rememberedLoginEmail, rememberLoginEmail, takeLoginNote } from './login/loginFlash';
import { FormNote, StepHeading } from './login/StepHeading';

/**
 * Sign-in step 1: email, password, Turnstile. Right: the server starts the
 * second step (a code, or first-time setup) and the page re-renders on it.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<{ field?: 'email' | 'password'; message: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const { execute, loading } = useApi<{ next: 'code' | 'setup' }>('/api/admin/login', { method: 'POST' });

  // After a later step sent the person back: the email they typed, and why.
  useEffect(() => {
    const remembered = rememberedLoginEmail();
    if (remembered) setEmail((current) => current || remembered);
    setNote(takeLoginNote());
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseLoginInput({ email, password });
    if (!parsed.ok) {
      setError({ field: parsed.field, message: parsed.message });
      return;
    }
    if (!token) {
      setError({ message: 'Wait for the security check, then try again.' });
      return;
    }
    setError(null);
    setNote(null);
    const result = await execute({ email, password, turnstileToken: token });
    if (result.error) {
      if (result.error.errorCode === 'ABORT_ERROR') return;
      const message = typeof result.error.details?.message === 'string' ? result.error.details.message : 'Sign-in failed. Please try again.';
      setError({ message });
      setPassword('');
      turnstileRef.current?.reset();
      return;
    }
    rememberLoginEmail(email);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <StepHeading focusOnMount={false}>Sign in</StepHeading>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormNote message={error && !error.field ? error.message : null} />
        {!error ? <FormNote message={note} tone="info" /> : null}
        <FormField label="Email" error={error?.field === 'email' ? error.message : null}>
          {(ids) => <Input {...ids} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
        </FormField>
        <FormField label="Password" error={error?.field === 'password' ? error.message : null}>
          {(ids) => <Input {...ids} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </FormField>
        <Turnstile ref={turnstileRef} action="login" onToken={setToken} onError={() => setError({ message: 'The security check did not load. Reload the page.' })} />
        <Button type="submit" variant="primary" loading={loading} className="w-full">
          Continue
        </Button>
      </form>
    </div>
  );
}
