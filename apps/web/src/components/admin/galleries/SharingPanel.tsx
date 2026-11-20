'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { Checkbox, FormField, Input } from '@repo/ui/input';
import { Caption, Heading, Mono, Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';
import { QrCode } from '@/components/admin/login/QrCode';
import { ConfirmDialog } from '@/components/admin/security/ConfirmDialog';
import { EmailStatusLine } from '@/components/admin/settings/emails/TestEmailForm';
import type { EmailView } from '@/lib/email/views';
import { generateGalleryPassword, PASSWORD_MAX, PASSWORD_MIN } from '@/lib/galleries/password';

import { adminFetch } from './adminFetch';
import { PublishButton } from './PublishButton';

export type SharingGallery = {
  id: string;
  slug: string;
  published: boolean;
  access: 'link' | 'password';
  clientName: string | null;
  clientEmail: string | null;
  /** `uploading` photos (the "still uploading" hint). */
  unfinished: number;
};

/**
 * *Share* (plan p05 → Screens): publish, the link (Copy, QR, *New link*), the password (shown, Copy,
 * Change, *Generate*, remove) and *Email the client* (preview, send, the live status). `siteUrl` = the
 * studio's website address (Settings → Studio): without it the link uses this browser's origin and
 * the email is disabled.
 */
export function ShareButton({ gallery, siteUrl }: { gallery: SharingGallery; siteUrl: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Share
      </Button>
      <SharingPanel gallery={gallery} siteUrl={siteUrl} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function SharingPanel({ gallery, siteUrl, open, onClose }: { gallery: SharingGallery; siteUrl: string | null; open: boolean; onClose: () => void }) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} className="max-w-xl">
      {open ? (
        <div className="flex flex-col gap-7">
          <div className="flex items-start justify-between gap-4">
            <Heading level={2} size="title" id={titleId}>
              Share
            </Heading>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
          <Section title="Status">
            <div className="flex flex-wrap items-center gap-3">
              <Text size="body-sm" weight="semibold">
                {gallery.published ? 'Live: your client can open it.' : 'Draft: only you can see it.'}
              </Text>
              <PublishButton galleryId={gallery.id} published={gallery.published} />
            </div>
            {gallery.unfinished > 0 ? (
              <Caption>
                {gallery.unfinished} {gallery.unfinished === 1 ? 'photo is' : 'photos are'} still uploading and won’t be visible yet.
              </Caption>
            ) : null}
          </Section>
          <LinkSection gallery={gallery} siteUrl={siteUrl} />
          <PasswordSection gallery={gallery} />
          <EmailSection gallery={gallery} siteUrl={siteUrl} />
        </div>
      ) : null}
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-5 first-of-type:border-t-0 first-of-type:pt-0">
      <Heading level={3} size="title-sm">
        {title}
      </Heading>
      {children}
    </section>
  );
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

function LinkSection({ gallery, siteUrl }: { gallery: SharingGallery; siteUrl: string | null }) {
  const router = useRouter();
  const path = `/g/${gallery.slug}`;
  // Without a website address, this browser's origin (set after mount: the server cannot know it).
  const [origin, setOrigin] = useState(siteUrl ?? '');
  useEffect(() => {
    if (!siteUrl) setOrigin(window.location.origin);
  }, [siteUrl]);
  const url = `${origin}${path}`;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="Link">
      <div className="flex flex-wrap items-center gap-2">
        <Mono size="body-sm" className="min-w-0 flex-1 break-all">
          {url}
        </Mono>
        <CopyButton value={url} />
      </div>
      {!gallery.published ? <Caption>The link works once the gallery is published.</Caption> : null}
      {origin ? <QrCode value={url} label={`QR code for ${url}`} size={160} /> : null}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
          New link
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Make a new link?"
        body="The old link stops working at once. Images already opened stay viewable."
        confirmLabel="New link"
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          const result = await adminFetch(`/api/admin/galleries/${gallery.id}/new-link`, { method: 'POST', body: {} });
          setBusy(false);
          setError(result.ok ? null : result.error);
          if (result.ok) {
            setConfirm(false);
            router.refresh();
          }
        }}
      />
    </Section>
  );
}

function PasswordSection({ gallery }: { gallery: SharingGallery }) {
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = gallery.access === 'password';

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!locked) return setPassword(null);
      const result = await adminFetch<{ password: string | null }>(`/api/admin/galleries/${gallery.id}/password`, { signal });
      if (signal?.aborted) return;
      if (result.ok) setPassword(result.data.password);
      else setError(result.error);
    },
    [gallery.id, locked],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function save(body: { access: 'link' | 'password'; password?: string }) {
    setBusy(true);
    const result = await adminFetch(`/api/admin/galleries/${gallery.id}`, { method: 'PATCH', body });
    setBusy(false);
    setError(result.ok ? null : result.error);
    if (!result.ok) return;
    setEditing(false);
    setDraft('');
    router.refresh();
    if (body.access === 'password') setPassword(body.password ?? null);
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save({ access: 'password', password: draft });
  };

  return (
    <Section title="Password">
      <FormNote message={error} />
      {locked && password ? (
        <div className="flex flex-wrap items-center gap-2">
          <Mono size="body-sm" className="break-all">
            {password}
          </Mono>
          <CopyButton value={password} />
        </div>
      ) : null}
      {!locked ? <Text size="body-sm">Anyone with the link can open the gallery.</Text> : null}
      {editing ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <FormField label="New password" hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters. Clients who used the old one are asked again.`}>
            {(ids) => (
              <div className="flex flex-wrap gap-2">
                <Input {...ids} value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" spellCheck={false} className="min-w-0 flex-1" />
                <Button type="button" variant="secondary" onClick={() => setDraft(generateGalleryPassword())}>
                  Generate
                </Button>
              </div>
            )}
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy}>
              Save password
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft(generateGalleryPassword());
              setEditing(true);
            }}
          >
            {locked ? 'Change' : 'Add a password'}
          </Button>
          {locked ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ access: 'link' })}>
              Remove the password
            </Button>
          ) : null}
        </div>
      )}
    </Section>
  );
}

type Preview = { subject: string; html: string; text: string };

function EmailSection({ gallery, siteUrl }: { gallery: SharingGallery; siteUrl: string | null }) {
  const [to, setTo] = useState(gallery.clientEmail ?? '');
  const [name, setName] = useState(gallery.clientName ?? '');
  const locked = gallery.access === 'password';
  const [includePassword, setIncludePassword] = useState(locked);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sent, setSent] = useState<EmailView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = !gallery.published ? 'draft' : !siteUrl ? 'site' : null;

  async function showPreview() {
    setBusy(true);
    const query = new URLSearchParams({ ...(includePassword && locked ? { include_password: '1' } : {}), ...(name.trim() ? { name: name.trim() } : {}) });
    const result = await adminFetch<Preview>(`/api/admin/galleries/${gallery.id}/email-preview?${query}`);
    setBusy(false);
    setError(result.ok ? null : result.error);
    setPreview(result.ok ? result.data : null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await adminFetch<EmailView>(`/api/admin/galleries/${gallery.id}/email`, {
      method: 'POST',
      body: { to, ...(name.trim() ? { name: name.trim() } : {}), includePassword: includePassword && locked },
    });
    setBusy(false);
    setError(result.ok ? null : result.error);
    if (result.ok) setSent(result.data);
  }

  return (
    <Section title="Email the client">
      {blocked === 'draft' ? <Caption>Publish the gallery first.</Caption> : null}
      {blocked === 'site' ? (
        <Caption>
          Set your website address in{' '}
          <Link href="/admin/settings/studio" className="underline">
            Settings → Studio
          </Link>{' '}
          first: the email links to it.
        </Caption>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormNote message={error} />
        <FormField label="Email address">
          {(ids) => (
            <Input {...ids} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={to} onChange={(e) => setTo(e.target.value)} />
          )}
        </FormField>
        <FormField label="Name" hint="Used in the greeting only.">
          {(ids) => <Input {...ids} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        {locked ? <Checkbox label="Include the password" checked={includePassword} onChange={(e) => setIncludePassword(e.target.checked)} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy || blocked !== null} onClick={() => void showPreview()}>
            Preview
          </Button>
          <Button type="submit" loading={busy} disabled={blocked !== null}>
            Send
          </Button>
        </div>
      </form>
      {preview ? (
        <div className="flex flex-col gap-2">
          <Text size="body-sm" weight="semibold">
            Subject: {preview.subject}
          </Text>
          {/* Sandboxed: no script, no same-origin access; the HTML is our own template's, escaped. */}
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-control border border-line bg-surface" />
        </div>
      ) : null}
      {sent ? <EmailStatusLine key={sent.id} initial={sent} sentNote="It is on its way to your client." /> : null}
    </Section>
  );
}
