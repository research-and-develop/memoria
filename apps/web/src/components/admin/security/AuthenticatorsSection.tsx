'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { DateText } from '@repo/ui/date';
import { Dialog } from '@repo/ui/dialog';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';
import { Heading, Text } from '@repo/ui/typography';

import { AuthenticatorSetup } from '@/components/admin/login/AuthenticatorSetup';
import { cleanDigits, CodeField } from '@/components/admin/login/CodeField';
import { FormNote } from '@/components/admin/login/StepHeading';

import { ConfirmDialog } from './ConfirmDialog';
import { isSignedOut, useConfirmThen } from './SecondFactor';
import { SecuritySection } from './SecuritySection';

export type AuthenticatorItem = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

const MAX_APPS = 10;
const message = (details: Record<string, unknown> | undefined, fallback: string) =>
  typeof details?.message === 'string' ? details.message : fallback;

/** Settings → Security → Authenticator apps: list, add, rename, remove (each confirmed with a code). */
export function AuthenticatorsSection({ apps, appName, defaultLabel }: { apps: AuthenticatorItem[]; appName: string; defaultLabel: string }) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const start = useApi<Enrollment>('/api/admin/authenticators/enrollments', { method: 'POST' });
  const full = apps.length >= MAX_APPS;

  const onAdd = async () => {
    setNote(null);
    const result = await confirmThen(() => start.execute({}));
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (result.error) {
      if (result.error.errorCode !== 'CANCELLED' && result.error.errorCode !== 'ABORT_ERROR') setNote(message(result.error.details, 'Could not start. Please try again.'));
      return;
    }
    setEnrollment(result.data);
  };

  return (
    <SecuritySection
      id="authenticators"
      title="Authenticator apps"
      description="A code from any of these apps signs you in."
      action={
        <Button variant="secondary" size="sm" onClick={onAdd} loading={start.loading} disabled={full} aria-describedby={full ? 'authenticators-full' : undefined}>
          Add an app
        </Button>
      }
    >
      {full ? (
        <Text as="p" id="authenticators-full" size="caption" tone="muted">
          You have {MAX_APPS} apps, the most there can be. Remove one to add another.
        </Text>
      ) : null}
      <FormNote message={note} />
      <ul className="flex flex-col divide-y divide-line">
        {apps.map((app) => (
          <AuthenticatorRow key={app.id} app={app} onlyOne={apps.length === 1} />
        ))}
      </ul>
      {enrollment ? (
        <AddAuthenticatorDialog
          enrollment={enrollment}
          appName={appName}
          defaultLabel={defaultLabel}
          onClose={(added) => {
            setEnrollment(null);
            if (added) router.refresh();
          }}
        />
      ) : null}
    </SecuritySection>
  );
}

function AuthenticatorRow({ app, onlyOne }: { app: AuthenticatorItem; onlyOne: boolean }) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(app.label);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rename = useApi(`/api/admin/authenticators/${app.id}`, { method: 'PATCH' });
  const remove = useApi(`/api/admin/authenticators/${app.id}`, { method: 'DELETE' });

  const onRename = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await confirmThen(() => rename.execute({ label }));
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (result.error) {
      if (result.error.errorCode !== 'CANCELLED') setError(message(result.error.details, 'Could not rename it. Please try again.'));
      return;
    }
    setEditing(false);
    router.refresh();
  };

  const onRemove = async () => {
    setError(null);
    const result = await confirmThen(() => remove.execute());
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (result.error) {
      if (result.error.errorCode !== 'CANCELLED') setError(message(result.error.details, 'Could not remove it. Please try again.'));
      return;
    }
    setRemoving(false);
    router.refresh();
  };

  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      {editing ? (
        <form onSubmit={onRename} className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
          <FormField label="Name" className="flex-1" error={error}>
            {(ids) => <Input {...ids} value={label} maxLength={60} autoFocus onChange={(e) => setLabel(e.target.value)} />}
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={rename.loading}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setLabel(app.label);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-0.5">
            <Text weight="semibold" className="truncate">
              {app.label}
            </Text>
            <Text size="caption" tone="muted">
              Added <DateText value={app.createdAt} pattern="d MMM yyyy" /> · {app.lastUsedAt ? <>last used <DateText value={app.lastUsedAt} fromNow /></> : 'not used yet'}
            </Text>
            {error && !removing ? (
              <Text as="p" size="caption" tone="danger" role="alert">
                {error}
              </Text>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Rename ${app.label}`}>
              Rename
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={onlyOne}
              aria-describedby={onlyOne ? `${app.id}-last` : undefined}
              aria-label={`Remove ${app.label}`}
              onClick={() => setRemoving(true)}
            >
              Remove
            </Button>
            {onlyOne ? (
              <Text id={`${app.id}-last`} size="caption" tone="muted">
                You need at least one
              </Text>
            ) : null}
          </div>
        </>
      )}
      <ConfirmDialog
        open={removing}
        title={`Remove ${app.label}?`}
        body="Codes from it stop working, and devices signed in with it are signed out."
        confirmLabel="Remove"
        busy={remove.loading}
        error={removing ? error : null}
        onConfirm={onRemove}
        onCancel={() => {
          setRemoving(false);
          setError(null);
        }}
      />
    </li>
  );
}

type Enrollment = { enrollmentId: string; secret: string; otpauthUri: string; expiresAt: string };

function AddAuthenticatorDialog({
  enrollment,
  appName,
  defaultLabel,
  onClose,
}: {
  enrollment: Enrollment;
  appName: string;
  defaultLabel: string;
  onClose: (added: boolean) => void;
}) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [label, setLabel] = useState(defaultLabel);
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ field?: 'label' | 'code'; message: string } | null>(null);
  const add = useApi<{ id: string }>('/api/admin/authenticators', { method: 'POST' });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return setError({ field: 'label', message: 'Enter a name for this app.' });
    if (code.length !== 6) return setError({ field: 'code', message: 'Enter the 6-digit code the app shows.' });
    setError(null);
    const result = await confirmThen(() => add.execute({ enrollmentId: enrollment.enrollmentId, label, code }));
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (!result.error) return onClose(true);
    if (result.error.errorCode === 'CANCELLED' || result.error.errorCode === 'ABORT_ERROR') return;
    const field = result.error.details?.field === 'label' ? 'label' : result.error.errorCode === 'CODE_INVALID' || result.error.errorCode === 'INVALID_PARAMS' ? 'code' : undefined;
    setError({ field, message: message(result.error.details, 'Could not add it. Please try again.') });
  };

  return (
    <Dialog open onClose={() => onClose(false)} aria-labelledby="add-authenticator-title" className="max-w-lg">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Heading level={2} size="title" id="add-authenticator-title">
          Add an authenticator app
        </Heading>
        <AuthenticatorSetup secret={enrollment.secret} otpauthUri={enrollment.otpauthUri} appName={appName} />
        <FormNote message={error && !error.field ? error.message : null} />
        <FormField label="Name of this app" hint="To tell your devices apart later." error={error?.field === 'label' ? error.message : null}>
          {(ids) => <Input {...ids} value={label} maxLength={60} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />}
        </FormField>
        <CodeField
          label="Code from the new app"
          hint="Codes change every 30 seconds."
          value={code}
          onChange={(v) => setCode(cleanDigits(v))}
          digits
          error={error?.field === 'code' ? error.message : null}
        />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={add.loading}>
            Add app
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
