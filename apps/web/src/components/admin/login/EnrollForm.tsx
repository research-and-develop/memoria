'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';
import { Mono, Text } from '@repo/ui/typography';

import { groupSecret } from '@/lib/auth/totp';

import { cleanDigits, CodeField } from './CodeField';
import { forgetLoginEmail, safeNext, setLoginNote } from './loginFlash';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { StartOver } from './StartOver';
import { FormNote, StepHeading } from './StepHeading';
import { stepErrorOutcome } from './stepError';

const QrCode = dynamic(() => import('./QrCode').then((m) => m.QrCode), {
  ssr: false,
  loading: () => <div className="h-[200px] w-[200px] rounded-control bg-wash" aria-hidden />,
});

type Enrolled = { expiresAt: string; recoveryCodes?: string[] };

/**
 * First sign-in, step 3: connect an authenticator app (QR code, an
 * "Open in authenticator app" link for this phone, or the secret typed by
 * hand), name it, and enter its first code. Then the recovery codes, once.
 */
export function EnrollForm({
  secret,
  otpauthUri,
  defaultLabel,
  appName,
  next,
}: {
  secret: string;
  otpauthUri: string;
  defaultLabel: string;
  appName: string;
  next?: string;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(defaultLabel);
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ field?: 'label' | 'code'; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLSpanElement>(null);
  const { execute, loading } = useApi<Enrolled>('/api/admin/login/verify', { method: 'POST' });
  const acknowledge = useApi('/api/admin/recovery-codes/acknowledge', { method: 'POST' });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!label.trim()) return setError({ field: 'label', message: 'Enter a name for this app.' });
    if (code.length !== 6) return setError({ field: 'code', message: 'Enter the 6-digit code the app shows.' });
    setError(null);
    const result = await execute({ code, label });
    if (result.error) {
      const outcome = stepErrorOutcome(result.error);
      if (outcome.kind === 'restart') {
        setLoginNote(outcome.note);
        router.refresh();
      } else if (outcome.kind === 'show') {
        setError({ field: result.error.details?.field === 'label' ? 'label' : 'code', message: outcome.message });
        codeRef.current?.focus();
        codeRef.current?.select();
      }
      return;
    }
    forgetLoginEmail();
    setCodes(result.data?.recoveryCodes ?? []);
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      const range = document.createRange();
      if (secretRef.current) range.selectNodeContents(secretRef.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  };

  if (codes) {
    return (
      <RecoveryCodesPanel
        codes={codes}
        appName={appName}
        continueLabel="Continue to the studio"
        onContinue={async () => {
          await acknowledge.execute({});
          router.replace(safeNext(next));
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeading>Connect your authenticator app</StepHeading>
      <Text as="p" size="body-sm" tone="ink2">
        Use any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, …). On this phone? Tap{' '}
        <strong className="font-semibold">Open in authenticator app</strong>. On a computer? Scan the code with your phone.
      </Text>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <QrCode value={otpauthUri} label={`QR code to add ${appName} to an authenticator app`} />
        <div className="flex w-full min-w-0 flex-col gap-3">
          <a href={otpauthUri} className="inline-flex min-h-11 items-center font-sans text-body-sm font-semibold text-accent-ink underline-offset-4 hover:underline">
            Open in authenticator app
          </a>
          <div className="flex flex-col gap-1">
            <Text size="caption" tone="muted">
              Or type this key into the app:
            </Text>
            <span ref={secretRef} className="break-all select-all">
              <Mono size="body-sm">{groupSecret(secret)}</Mono>
            </span>
            <Button variant="secondary" size="sm" className="self-start" onClick={copySecret}>
              {copied ? 'Copied' : 'Copy key'}
            </Button>
          </div>
        </div>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormNote message={error && !error.field ? error.message : null} />
        <FormField label="Name of this app" hint="To tell your devices apart later." error={error?.field === 'label' ? error.message : null}>
          {(ids) => <Input {...ids} value={label} maxLength={60} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />}
        </FormField>
        <CodeField
          ref={codeRef}
          label="Code from the app"
          hint="Codes change every 30 seconds."
          value={code}
          onChange={(v) => setCode(cleanDigits(v))}
          digits
          error={error?.field === 'code' ? error.message : null}
        />
        <Button type="submit" variant="primary" loading={loading} className="w-full">
          Connect and sign in
        </Button>
      </form>
      <div className="flex justify-end">
        <StartOver />
      </div>
    </div>
  );
}
