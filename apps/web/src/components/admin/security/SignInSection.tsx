'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi, type ApiResult } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';
import { Mono, Text } from '@repo/ui/typography';

import { setLoginNote } from '@/components/admin/login/loginFlash';
import { FormNote } from '@/components/admin/login/StepHeading';
import { SettingsCard } from '@/components/admin/settings/SettingsCard';
import { generatePassword } from '@/lib/auth/generatePassword';
import { newPasswordProblem, parseEmailChange } from '@/lib/auth/parseAccountInput';

import { isSignedOut, useConfirmThen } from './SecondFactor';

export type SignInAccount = {
  email: string;
  /** The password was set by `npm run admin:mfa -- password`: ask the photographer to choose their own. */
  installerPassword: boolean;
  /** A database account while ADMIN_PASSWORD_HASH is still set on the server (D2b.2). */
  envPasswordStillSet: boolean;
};

type FieldError = { field?: string; message: string } | null;

export const PASSWORD_CHANGED_NOTE = 'Password changed. Sign in again.';

function errorOf(result: ApiResult<unknown>, fallback: string): FieldError {
  const details = result.error?.details;
  const message = typeof details?.message === 'string' ? details.message : fallback;
  return { field: typeof details?.field === 'string' ? details.field : undefined, message };
}

/**
 * Settings → Security → Your sign-in (plan p02b): the email and password.
 * Each change asks for a code first (the confirm window, D2.9), then checks
 * the current password; a new password signs out every device.
 */
export function SignInSection({ account }: { account: SignInAccount }) {
  const [open, setOpen] = useState<'email' | 'password' | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const toggle = (form: 'email' | 'password') => {
    setDone(null);
    setOpen((current) => (current === form ? null : form));
  };

  return (
    <SettingsCard id="sign-in" title="Your sign-in" description="The email and password you sign in with. Changing either asks for a code first.">
      <div className="flex flex-col gap-1">
        <Text as="p" size="body-sm" tone="muted">
          Email
        </Text>
        <Mono as="p" size="body-sm" className="break-all">
          {account.email}
        </Mono>
      </div>
      {account.installerPassword ? (
        <Text as="p" size="body-sm" weight="semibold" tone="alert">
          This password was set when the site was installed. Choose your own.
        </Text>
      ) : null}
      {account.envPasswordStillSet ? (
        <Text as="p" size="body-sm" tone="alert">
          The installer&apos;s password is still in the server configuration. Ask them to remove ADMIN_PASSWORD_HASH and ADMIN_EMAIL.
        </Text>
      ) : null}
      <FormNote message={done} tone="info" />
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" size="sm" aria-expanded={open === 'email'} onClick={() => toggle('email')}>
          Change email
        </Button>
        <Button variant="secondary" size="sm" aria-expanded={open === 'password'} onClick={() => toggle('password')}>
          Change password
        </Button>
      </div>
      {open === 'email' ? (
        <EmailForm
          onCancel={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            setDone('Email changed. Sign in with the new one from now on.');
          }}
        />
      ) : null}
      {open === 'password' ? <PasswordForm email={account.email} onCancel={() => setOpen(null)} /> : null}
    </SettingsCard>
  );
}

function useSignedOutRedirect() {
  const router = useRouter();
  return () => {
    router.replace('/admin/login');
    router.refresh();
  };
}

function EmailForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const router = useRouter();
  const signedOut = useSignedOutRedirect();
  const confirmThen = useConfirmThen();
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState<FieldError>(null);
  const { execute, loading } = useApi<{ email: string }>('/api/admin/account/email', { method: 'PATCH' });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseEmailChange({ email, currentPassword });
    if (!parsed.ok) return setError({ field: parsed.field, message: parsed.message });
    setError(null);
    const result = await confirmThen(() => execute({ email, currentPassword }));
    if (isSignedOut(result)) return signedOut();
    if (result.error) {
      if (result.error.errorCode === 'CANCELLED' || result.error.errorCode === 'ABORT_ERROR') return;
      setCurrentPassword('');
      return setError(errorOf(result, 'Could not change the email. Please try again.'));
    }
    router.refresh();
    onDone();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-5 border-t border-line pt-5">
      <FormNote message={error && !error.field ? error.message : null} />
      <FormField label="New email" error={error?.field === 'email' ? error.message : null}>
        {(ids) => <Input {...ids} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
      </FormField>
      <FormField label="Current password" error={error?.field === 'currentPassword' ? error.message : null}>
        {(ids) => <Input {...ids} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
      </FormField>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" loading={loading}>
          Change email
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PasswordForm({ email, onCancel }: { email: string; onCancel: () => void }) {
  const signedOut = useSignedOutRedirect();
  const confirmThen = useConfirmThen();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<FieldError>(null);
  const { execute, loading } = useApi<{ signedOut: true }>('/api/admin/account/password', { method: 'PATCH' });

  const generate = () => {
    const password = generatePassword();
    setGenerated(password);
    setNewPassword(password);
    setRepeat(password);
    setCopied(false);
    setError(null);
  };

  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentPassword) return setError({ field: 'currentPassword', message: 'Enter your current password.' });
    const problem = newPasswordProblem(newPassword, email);
    if (problem) return setError({ field: 'newPassword', message: problem });
    if (repeat !== newPassword) return setError({ field: 'repeat', message: 'The two new passwords are not the same.' });
    setError(null);
    const result = await confirmThen(() => execute({ currentPassword, newPassword }));
    if (result.error) {
      if (isSignedOut(result)) return signedOut();
      if (result.error.errorCode === 'CANCELLED' || result.error.errorCode === 'ABORT_ERROR') return;
      setCurrentPassword('');
      return setError(errorOf(result, 'Could not change the password. Please try again.'));
    }
    setLoginNote(PASSWORD_CHANGED_NOTE);
    signedOut();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-5 border-t border-line pt-5">
      <FormNote message={error && !error.field ? error.message : null} />
      <FormField label="Current password" error={error?.field === 'currentPassword' ? error.message : null}>
        {(ids) => (
          <Input {...ids} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
        )}
      </FormField>
      <FormField label="New password" hint="At least 12 characters. Signing in again is needed on every device." error={error?.field === 'newPassword' ? error.message : null}>
        {(ids) => (
          <Input
            {...ids}
            type={generated ? 'text' : 'password'}
            autoComplete="new-password"
            spellCheck={false}
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setGenerated(null);
            }}
          />
        )}
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={generate}>
          Generate a password
        </Button>
        {generated ? (
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        ) : null}
      </div>
      {generated ? (
        <Text as="p" size="body-sm" tone="muted">
          Save it in your password manager before you continue: it is not shown again.
        </Text>
      ) : null}
      <FormField label="Repeat the new password" error={error?.field === 'repeat' ? error.message : null}>
        {(ids) => (
          <Input {...ids} type={generated ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        )}
      </FormField>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" loading={loading}>
          Change password
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
