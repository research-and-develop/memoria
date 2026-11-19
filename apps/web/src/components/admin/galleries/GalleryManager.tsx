'use client';

import { useCallback, useId, useState } from 'react';

import { Segmented } from '@repo/ui/segmented';
import { TabPanel, Tabs } from '@repo/ui/tabs';
import { Caption } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';
import { SettingsCard } from '@/components/admin/settings/SettingsCard';

import { adminFetch } from './adminFetch';
import { BulkBar } from './BulkBar';
import { PhotoGrid } from './PhotoGrid';
import { SetsRail, type ManagerSet } from './SetsRail';

export type ManagerGallery = {
  id: string;
  coverPhotoId: string | null;
  sort: 'filename' | 'taken';
  sets: ManagerSet[];
};

type Tab = 'photos' | 'settings';
const TABS = [
  { value: 'photos', label: 'Photos' },
  { value: 'settings', label: 'Settings' },
] as const;
const SORTS = [
  { value: 'filename', label: 'Filename' },
  { value: 'taken', label: 'Capture time' },
] as const;

type GalleryResponse = { cover_photo_id: string | null; settings: { sort: 'filename' | 'taken' }; sets: ManagerSet[] };

/**
 * The gallery manager (plan p05 → Screens): *Photos* (sets rail, grid, selection, bulk bar, and the
 * uploader slot) and *Settings* (order; delete arrives with commit 8). Selections, Downloads and
 * Activity tabs come with Phases 8, 9 and 11. Every change reloads the gallery from the API.
 */
export function GalleryManager({ initial }: { initial: ManagerGallery }) {
  const tabsId = useId();
  const [tab, setTab] = useState<Tab>('photos');
  const [gallery, setGallery] = useState(initial);
  const [setId, setSetId] = useState(initial.sets[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await adminFetch<GalleryResponse>(`/api/admin/galleries/${initial.id}`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const sets = result.data.sets;
    setGallery({ id: initial.id, coverPhotoId: result.data.cover_photo_id, sort: result.data.settings.sort, sets });
    setSetId((current) => (sets.some((s) => s.id === current) ? current : (sets[0]?.id ?? '')));
    setSelected(new Set());
    setVersion((v) => v + 1);
  }, [initial.id]);

  async function changeSort(sort: 'filename' | 'taken') {
    const result = await adminFetch(`/api/admin/galleries/${initial.id}`, { method: 'PATCH', body: { sort } });
    setError(result.ok ? null : result.error);
    if (result.ok) await reload();
  }

  return (
    <div className="flex flex-col gap-5">
      <Tabs id={tabsId} items={TABS} value={tab} onValueChange={setTab} aria-label="Gallery" />
      <FormNote message={error} />
      <TabPanel id={tabsId} value="photos" selected={tab === 'photos'}>
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <SetsRail
            galleryId={gallery.id}
            sets={gallery.sets}
            selected={setId}
            onSelect={(id) => {
              setSetId(id);
              setSelected(new Set());
            }}
            onChanged={() => void reload()}
            onError={setError}
          />
          <div className="flex min-w-0 flex-col gap-4">
            {/* The uploader (lane C, T5.5) mounts here: drop zone + panel for `setId`, reload() when photos are ready. */}
            {setId ? <PhotoGrid galleryId={gallery.id} setId={setId} coverId={gallery.coverPhotoId} version={version} selected={selected} onSelectedChange={setSelected} /> : null}
            {selected.size > 0 ? (
              <BulkBar galleryId={gallery.id} selected={[...selected]} sets={gallery.sets} currentSet={setId} onDone={() => void reload()} onError={setError} />
            ) : null}
          </div>
        </div>
      </TabPanel>
      <TabPanel id={tabsId} value="settings" selected={tab === 'settings'}>
        <SettingsCard id="order" title="Order" description="How photos are ordered in every set, for you and your client.">
          <Segmented options={SORTS} value={gallery.sort} onValueChange={(sort) => void changeSort(sort)} aria-label="Photo order" />
          <Caption>Changing the order re-sorts every photo in the gallery.</Caption>
        </SettingsCard>
      </TabPanel>
    </div>
  );
}
