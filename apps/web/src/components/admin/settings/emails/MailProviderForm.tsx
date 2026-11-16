'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input, Select } from '@repo/ui/input';
import { Text } from '@repo/ui/typography';
import { SES_REGIONS } from '@repo/platform/mail/sesRegions';

import { FormNote } from '@/components/admin/login/StepHeading';
import { isSignedOut, useConfirmThen } from '@/components/admin/security/SecondFactor';
import {
  MAIL_PROVIDER_LABELS,
  MAIL_PROVIDERS,
  MAX_FROM_NAME_LENGTH,
  parseMailSettingsInput,
  settingsFromView,
  type MailProvider,
  type MailSettingsView,
} from '@/lib/settings/parseMailSettings';

import { SettingsCard } from '../SettingsCard';

export type MailFormProps = {
  /** The saved settings (no secret), or null. */
  saved: MailSettingsView | null;
  /** Email currently goes through the server's development settings (MAIL_FROM + SMTP_*). */
  usingEnvFallback: boolean;
  /** The server has SETTINGS_ENCRYPTION_KEY (else nothing can be saved). */
  canSave: boolean;
  studioName: string;
};

type FieldError = { field?: string; message: string } | null;

const HELP: Record<MailProvider, string> = {
  smtp: 'Your mail provider’s SMTP server. Use an app password, not your account password. Port 587 or 2525 = STARTTLS, 465 = TLS.',
  brevo: 'An API key from Brevo (SMTP & API → API keys). Turn IP allow-listing off in Brevo: this server has no fixed address.',
  ses: 'The access key of an IAM user allowed to send only from your verified domain. The region is your domain identity’s.',
  microsoft365: 'An Entra app registration with a client secret, allowed to send as one mailbox (RBAC for Applications in Exchange Online).',
};

/** Draft keys whose parser field has another name. */
const ERROR_FIELD: Record<string, string> = { fromEmail: 'from.email', fromName: 'from.name' };

/** Strings for every field of every provider, so switching keeps what was typed. */
type Draft = Record<string, string>;

function initialDraft(saved: MailSettingsView | null): Draft {
  return {
    fromEmail: saved?.from.email ?? '',
    fromName: saved?.from.name ?? '',
    replyTo: saved?.replyTo ?? '',
    'smtp.host': saved?.smtp?.host ?? '',
    'smtp.port': String(saved?.smtp?.port ?? 587),
    'smtp.username': saved?.smtp?.username ?? '',
    'ses.region': saved?.ses?.region ?? 'eu-west-1',
    'ses.accessKeyId': saved?.ses?.accessKeyId ?? '',
    'microsoft365.tenantId': saved?.microsoft365?.tenantId ?? '',
    'microsoft365.clientId': saved?.microsoft365?.clientId ?? '',
    'microsoft365.mailbox': saved?.microsoft365?.mailbox ?? '',
    'smtp.password': '',
    'brevo.apiKey': '',
    'ses.secretAccessKey': '',
    'microsoft365.clientSecret': '',
  };
}

function toBody(provider: MailProvider, d: Draft) {
  const blocks = {
    smtp: { host: d['smtp.host'], port: Number(d['smtp.port']), username: d['smtp.username'], password: d['smtp.password'] },
    brevo: { apiKey: d['brevo.apiKey'] },
    ses: { region: d['ses.region'], accessKeyId: d['ses.accessKeyId'], secretAccessKey: d['ses.secretAccessKey'] },
    microsoft365: { tenantId: d['microsoft365.tenantId'], clientId: d['microsoft365.clientId'], clientSecret: d['microsoft365.clientSecret'], mailbox: d['microsoft365.mailbox'] },
  };
  return { provider, from: { email: d.fromEmail, name: d.fromName }, replyTo: d.replyTo, [provider]: blocks[provider] };
}

/**
 * Settings → Emails → Sending (plan p03, D3.17): how email leaves. The secret is never shown: a
 * saved one reads "Saved — leave empty to keep" while the provider's other details stay the same.
 * Saving asks for a code.
 */
export function MailProviderForm({ saved, usingEnvFallback, canSave, studioName }: MailFormProps) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [provider, setProvider] = useState<MailProvider>(saved?.provider ?? 'brevo');
  const [draft, setDraft] = useState<Draft>(() => initialDraft(saved));
  const [error, setError] = useState<FieldError>(null);
  const [done, setDone] = useState<string | null>(null);
  const { execute, loading } = useApi<MailSettingsView>('/api/admin/settings/mail', { method: 'PUT' });

  const set = (key: string) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const fieldError = (key: string) => (error?.field === (ERROR_FIELD[key] ?? key) ? error.message : null);
  const secretKept = saved?.provider === provider && saved.secretSaved;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    const body = toBody(provider, draft);
    const parsed = parseMailSettingsInput(body, saved ? settingsFromView(saved) : null);
    if (!parsed.ok) return setError({ field: parsed.field, message: parsed.message });
    setError(null);
    const result = await confirmThen(() => execute(body));
    if (isSignedOut(result)) {
      router.replace('/admin/login');
      return router.refresh();
    }
    if (result.error || !result.data) {
      if (result.error?.errorCode === 'CANCELLED' || result.error?.errorCode === 'ABORT_ERROR') return;
      const details = result.error?.details;
      return setError({
        field: typeof details?.field === 'string' ? details.field : undefined,
        message: typeof details?.message === 'string' ? details.message : 'Could not save the email settings. Please try again.',
      });
    }
    setDraft((d) => ({ ...d, 'smtp.password': '', 'brevo.apiKey': '', 'ses.secretAccessKey': '', 'microsoft365.clientSecret': '' }));
    setDone('Saved. Send a test email below to check it.');
    router.refresh();
  };

  const secretInput = (key: string, label: string) => (
    <FormField label={label} hint={secretKept ? 'Saved. Leave it empty to keep it.' : undefined} error={fieldError(key)}>
      {(ids) => (
        <Input
          {...ids}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          placeholder={secretKept ? 'Saved — leave empty to keep' : undefined}
          value={draft[key] ?? ''}
          onChange={set(key)}
        />
      )}
    </FormField>
  );
  const textInput = (key: string, label: string, opts: { hint?: string; placeholder?: string; inputMode?: 'email' | 'url' | 'text' } = {}) => (
    <FormField label={label} hint={opts.hint} error={fieldError(key)}>
      {(ids) => (
        <Input
          {...ids}
          type="text"
          inputMode={opts.inputMode ?? 'text'}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={opts.placeholder}
          value={draft[key] ?? ''}
          onChange={set(key)}
        />
      )}
    </FormField>
  );

  return (
    <SettingsCard id="sending" title="Sending" description="How your studio’s emails leave: your own mail server or an email service.">
      {usingEnvFallback ? (
        <Text as="p" size="body-sm" tone="muted">
          Emails go out through the server’s development settings until you save a provider here.
        </Text>
      ) : null}
      {!canSave ? <FormNote message="The server has no SETTINGS_ENCRYPTION_KEY yet, so these settings cannot be saved. The person who installed Memoria must set it." /> : null}
      <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-5">
        <FormNote message={error && !error.field ? error.message : null} />
        <Text as="p" size="body-sm" tone="muted">
          Already use Microsoft 365: choose it. Starting fresh: Brevo has a free tier. Amazon SES is cheapest at volume but needs a request for production access. SMTP server for anything else.
        </Text>
        <FormField label="Send with" hint={HELP[provider]} error={fieldError('provider')}>
          {(ids) => (
            <Select {...ids} value={provider} onChange={(e) => setProvider(e.target.value as MailProvider)}>
              {MAIL_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {MAIL_PROVIDER_LABELS[p]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {provider === 'smtp' ? (
          <>
            {textInput('smtp.host', 'Server', { placeholder: 'smtp.example.com', inputMode: 'url' })}
            <FormField label="Port" error={fieldError('smtp.port')}>
              {(ids) => (
                <Select {...ids} value={draft['smtp.port']} onChange={set('smtp.port')}>
                  <option value="587">587 (STARTTLS)</option>
                  <option value="465">465 (TLS)</option>
                  <option value="2525">2525 (STARTTLS)</option>
                </Select>
              )}
            </FormField>
            {textInput('smtp.username', 'Username', { hint: 'Often your full email address.' })}
            {secretInput('smtp.password', 'Password')}
          </>
        ) : null}
        {provider === 'brevo' ? secretInput('brevo.apiKey', 'API key') : null}
        {provider === 'ses' ? (
          <>
            <FormField label="Region" error={fieldError('ses.region')}>
              {(ids) => (
                <Select {...ids} value={draft['ses.region']} onChange={set('ses.region')}>
                  {SES_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {textInput('ses.accessKeyId', 'Access key ID', { placeholder: 'AKIA…' })}
            {secretInput('ses.secretAccessKey', 'Secret access key')}
          </>
        ) : null}
        {provider === 'microsoft365' ? (
          <>
            {textInput('microsoft365.tenantId', 'Tenant ID', { hint: 'A GUID, or your domain such as yourstudio.onmicrosoft.com.' })}
            {textInput('microsoft365.clientId', 'Application (client) ID')}
            {secretInput('microsoft365.clientSecret', 'Client secret')}
            {textInput('microsoft365.mailbox', 'Sending mailbox', { hint: 'Leave it empty to send as the From address.', inputMode: 'email' })}
          </>
        ) : null}

        {textInput('fromEmail', 'From address', { hint: 'An address on your domain, verified with the provider.', placeholder: 'hello@yourstudio.com', inputMode: 'email' })}
        <FormField label="From name" hint={`What clients see as the sender. Empty: “${studioName}”.`} error={fieldError('fromName')}>
          {(ids) => <Input {...ids} maxLength={MAX_FROM_NAME_LENGTH * 2} placeholder={studioName} value={draft.fromName ?? ''} onChange={set('fromName')} />}
        </FormField>
        {textInput('replyTo', 'Reply-to (optional)', { hint: 'Where replies go, if not the From address.', inputMode: 'email' })}
        <FormNote message={done} tone="info" />
        <div>
          <Button type="submit" variant="primary" loading={loading} disabled={!canSave}>
            Save
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
