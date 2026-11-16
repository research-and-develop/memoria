'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input } from '@repo/ui/input';
import { Mono, Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';
import { isSignedOut, useConfirmThen } from '@/components/admin/security/SecondFactor';
import { parseSiteUrl, parseStudioInput, STUDIO_NAME_MAX, type Studio } from '@/lib/settings/parseStudioInput';

import { SettingsCard } from './SettingsCard';

export type StudioFormProps = {
  /** The settings as they take effect now. */
  studio: Studio;
  /** SITE_URL, what an empty address falls back to (null = the address the site is opened on). */
  defaultSiteUrl: string | null;
  isDevelopment: boolean;
};

type FieldError = { field?: string; message: string } | null;

const LINK = 'inline-flex min-h-11 items-center font-sans text-body-sm font-semibold text-accent-ink underline-offset-4 hover:underline';

/**
 * Settings → Studio (plan p02b, D2b.9): the studio name and the website
 * address. The address is shown as it will be saved, with a link to check
 * that it opens this site; changing it asks for a code first.
 */
export function StudioSection({ studio, defaultSiteUrl, isDevelopment }: StudioFormProps) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [name, setName] = useState(studio.name);
  const [siteUrl, setSiteUrl] = useState(studio.siteUrl ?? '');
  const [error, setError] = useState<FieldError>(null);
  const [done, setDone] = useState<string | null>(null);
  const { execute, loading } = useApi<Studio>('/api/admin/settings/studio', { method: 'PATCH' });

  const address = parseSiteUrl(siteUrl, { isDevelopment });
  const effective = address.ok ? (address.value ?? defaultSiteUrl) : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    const parsed = parseStudioInput({ name, siteUrl }, { isDevelopment });
    if (!parsed.ok) return setError({ field: parsed.field, message: parsed.message });
    setError(null);
    const result = await confirmThen(() => execute(parsed.value));
    if (isSignedOut(result)) {
      router.replace('/admin/login');
      return router.refresh();
    }
    if (result.error || !result.data) {
      if (result.error?.errorCode === 'CANCELLED' || result.error?.errorCode === 'ABORT_ERROR') return;
      const details = result.error?.details;
      return setError({
        field: typeof details?.field === 'string' ? details.field : undefined,
        message: typeof details?.message === 'string' ? details.message : 'Could not save the settings. Please try again.',
      });
    }
    setName(result.data.name);
    setSiteUrl(parsed.value.siteUrl ?? '');
    setDone('Saved.');
    router.refresh();
  };

  return (
    <SettingsCard id="studio" title="Studio" description="Your studio's name and the address clients open your galleries on.">
      <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-5">
        <FormNote message={error && !error.field ? error.message : null} />
        <FormField
          label="Studio name"
          hint="Shown on every page, in the studio, in authenticator apps and in your emails."
          error={error?.field === 'name' ? error.message : null}
        >
          {(ids) => <Input {...ids} autoComplete="organization" maxLength={STUDIO_NAME_MAX * 2} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        <FormField
          label="Website address"
          hint={
            defaultSiteUrl
              ? `Set it once your own domain opens this site. Leave it empty to use ${defaultSiteUrl}, set when the site was installed. Changing it asks for a code.`
              : 'Set it once your own domain opens this site. Leave it empty to use whichever address the site is opened on. Changing it asks for a code.'
          }
          error={error?.field === 'siteUrl' ? error.message : null}
        >
          {(ids) => (
            <Input
              {...ids}
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="photos.example.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
            />
          )}
        </FormField>
        {effective ? (
          <div className="flex flex-col gap-1">
            <Text as="p" size="body-sm" tone="muted">
              {effective === studio.siteUrl ? 'In use' : 'After saving'}
            </Text>
            <Mono as="p" size="body-sm" className="break-all">
              {effective}
            </Mono>
            <a href={`${effective}/healthz`} target="_blank" rel="noopener noreferrer" className={LINK}>
              Check it opens<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        ) : null}
        <FormNote message={done} tone="info" />
        <div>
          <Button type="submit" variant="primary" loading={loading}>
            Save
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
