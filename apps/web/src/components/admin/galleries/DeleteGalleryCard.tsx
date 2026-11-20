'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { FormField, Input } from '@repo/ui/input';
import { Heading, Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';
import { SettingsCard } from '@/components/admin/settings/SettingsCard';

import { adminFetch } from './adminFetch';

/**
 * Delete (plan p05 → Screens, D5.17): a danger card; the dialog asks for the gallery's title. The
 * gallery leaves the lists and its client link at once and can be restored from *Deleted* for 7 days.
 */
export function DeleteGalleryCard({ galleryId, title }: { galleryId: string; title: string }) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === title.trim();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    const result = await adminFetch(`/api/admin/galleries/${galleryId}`, { method: 'DELETE' });
    setBusy(false);
    setError(result.ok ? null : result.error);
    if (result.ok) router.push('/admin/galleries');
  }

  return (
    <SettingsCard id="delete" title="Delete gallery" description="It disappears for your client at once. You can restore it from Deleted for 7 days; then it and its photos are removed for good.">
      <div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete gallery
        </Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby={titleId}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <Heading level={2} size="title" id={titleId}>
            Delete this gallery?
          </Heading>
          <Text as="p" size="body-sm" tone="ink2">
            Type the gallery’s title to confirm: <strong>{title}</strong>
          </Text>
          <FormNote message={error} />
          <FormField label="Gallery title">
            {(ids) => <Input {...ids} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />}
          </FormField>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!matches}>
              Delete
            </Button>
          </div>
        </form>
      </Dialog>
    </SettingsCard>
  );
}
