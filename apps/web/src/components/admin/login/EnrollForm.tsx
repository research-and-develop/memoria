'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';

import { AuthenticatorSetup } from './AuthenticatorSetup';
import { cleanDigits, CodeField } from './CodeField';
import { forgetLoginEmail, safeNext, setLoginNote } from './loginFlash';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { StartOver } from './StartOver';
import { FormNote, StepHeading } from './StepHeading';
import { stepErrorOutcome } from './stepError';

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
  const [codes, setCodes] = useState<string[] | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
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
      <AuthenticatorSetup secret={secret} otpauthUri={otpauthUri} appName={appName} />
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
