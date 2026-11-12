'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';

import { Turnstile, type TurnstileHandle } from '@/components/forms/Turnstile';
import { parseLoginInput } from '@/lib/auth/parseLoginInput';

/** The admin login form: email, password, Turnstile. */
export function LoginForm({ next = '/admin' }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<{ field?: 'email' | 'password'; message: string } | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const { execute, loading } = useApi('/api/admin/login', { method: 'POST' });

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
    const result = await execute({ email, password, turnstileToken: token });
    if (result.error) {
      if (result.error.errorCode === 'ABORT_ERROR') return;
      const message = typeof result.error.details?.message === 'string' ? result.error.details.message : 'Sign-in failed. Please try again.';
      setError({ message });
      setPassword('');
      turnstileRef.current?.reset();
      return;
    }
    router.replace(next.startsWith('/admin') ? next : '/admin');
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div aria-live="polite">
        {error && !error.field ? (
          <p role="alert" className="rounded-control bg-danger-wash px-4 py-3 text-body-sm font-semibold text-danger">
            {error.message}
          </p>
        ) : null}
      </div>
      <FormField label="Email" error={error?.field === 'email' ? error.message : null}>
        {(ids) => <Input {...ids} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
      </FormField>
      <FormField label="Password" error={error?.field === 'password' ? error.message : null}>
        {(ids) => <Input {...ids} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </FormField>
      <Turnstile ref={turnstileRef} action="login" onToken={setToken} onError={() => setError({ message: 'The security check did not load. Reload the page.' })} />
      <Button type="submit" variant="primary" loading={loading} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
