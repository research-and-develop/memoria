'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Caption, Text } from '@repo/ui/typography';

import type { DroppedFile } from '@/lib/images/folders';
import type { ProcessOptions } from '@/lib/images/process';
import { UploadApiError, type UploadSnapshot } from '@/lib/images/uploader';
import { postJson, uploaderFor } from '@/lib/images/uploaderStore';
import { parseWatermarkInput, type Watermark } from '@/lib/settings/parseWatermarkInput';

import { DropZone } from './DropZone';
import { planFolderSets, type SetRef } from './folderSets';
import { plural } from './format';
import { UploadPanel } from './UploadPanel';

/** What the pipeline needs from `GET /api/admin/galleries/[id]` (D5.4: the snapshot, never the studio's current settings). */
export type UploadProfile = {
  processing: { display: { longEdge: number; quality: number }; thumb: { longEdge: number; quality: number } };
  /** The processing snapshot's watermark, or null. */
  watermark: Record<string, unknown> | null;
  /** Where an image watermark loads from (public media domain or the dev read route). */
  imageUrl: string | null;
};

export type GalleryUploaderProps = {
  galleryId: string;
  /** The set loose photos go into: the manager's current set. */
  setId: string;
  /** The gallery's sets, for folders → sets. */
  sets: readonly SetRef[];
  profile: UploadProfile;
  /** Photos of this gallery still `uploading` on the server (the unfinished-uploads banner). */
  unfinished?: number;
  /** Photos of these sets became ready (at most once per `READY_EVERY_MS` while a run lasts). */
  onPhotosReady: (setIds: string[]) => void;
  /** Sets were created for dropped folders. */
  onSetsChanged: () => void;
};

/** A complete batch is 8 photos: without a window, a 500-photo run would reload the manager 60 times. */
export const READY_EVERY_MS = 3000;

const EMPTY: UploadSnapshot = {
  files: [],
  counts: { queued: 0, processing: 0, waiting: 0, uploading: 0, completing: 0, done: 0, duplicate: 0, refused: 0, failed: 0, cancelled: 0 },
  running: false,
  bytes: { sent: 0, total: 0 },
  startedAt: null,
};

/** The snapshot's watermark as the pipeline draws it; `invalid` when one is set but cannot be read. */
export function snapshotWatermark(raw: Record<string, unknown> | null): Watermark | null | 'invalid' {
  if (!raw) return null;
  const parsed = parseWatermarkInput(raw);
  return parsed.ok ? parsed.value : 'invalid';
}

/**
 * Upload into a gallery (plan p05 T5.5), mounted in the manager's *Photos* tab: drop photos or
 * folders, watch the panel. Dropped folders become sets first (an existing set of the same name is
 * reused); loose files go to the current set. The uploader lives outside React (`uploaderFor`), so it
 * keeps running while the manager re-renders or switches sets; the page asks before closing while it runs.
 */
export function GalleryUploader({ galleryId, setId, sets, profile, unfinished = 0, onPhotosReady, onSetsChanged }: GalleryUploaderProps) {
  const uploader = useMemo(() => uploaderFor(galleryId), [galleryId]);
  const snapshot = useSyncExternalStore(uploader.subscribe, uploader.getSnapshot, () => EMPTY);
  const [now, setNow] = useState(() => Date.now());
  const mark = useMemo(() => snapshotWatermark(profile.watermark), [profile.watermark]);
  /** Sets created here, until the manager's `sets` include them (a second drop must not create them again). */
  const [created, setCreated] = useState<SetRef[]>([]);
  const allSets = useMemo(() => [...sets, ...created.filter((c) => !sets.some((s) => s.id === c.id))], [sets, created]);
  const [preparing, setPreparing] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const callbacks = useRef({ onPhotosReady, onSetsChanged });
  callbacks.current = { onPhotosReady, onSetsChanged };

  // Ready photos: the first batch at once, then at most one call per window.
  useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (pending.size === 0) return;
      const ready = [...pending];
      pending.clear();
      callbacks.current.onPhotosReady(ready);
      timer = setTimeout(flush, READY_EVERY_MS);
    };
    const off = uploader.onReady((readySet) => {
      pending.add(readySet);
      if (!timer) flush();
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [uploader]);

  // Ask before leaving while photos are on their way.
  useEffect(() => {
    if (!snapshot.running) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [snapshot.running]);

  // A clock for the time left, only while running.
  useEffect(() => {
    if (!snapshot.running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [snapshot.running]);

  const set = allSets.find((s) => s.id === setId);
  const options: ProcessOptions | null =
    mark === 'invalid'
      ? null
      : { display: profile.processing.display, thumb: profile.processing.thumb, watermark: mark, watermarkUrl: mark?.kind === 'image' ? profile.imageUrl : null };

  const onFiles = async (files: DroppedFile[]) => {
    if (!options || !set) return;
    setDropError(null);
    const plan = planFolderSets(new Set(files.flatMap((f) => (f.set === null ? [] : [f.set]))), allSets);
    const setOf = new Map(plan.existing);
    if (plan.create.size > 0) {
      setPreparing(true);
      const made: SetRef[] = [];
      try {
        for (const name of new Set(plan.create.values())) {
          const { id } = await postJson<{ id: string }>(`/api/admin/galleries/${galleryId}/sets`, { name }, new AbortController().signal);
          made.push({ id, name });
        }
      } catch (error) {
        setDropError(`${error instanceof UploadApiError ? error.message : 'The sets for the dropped folders could not be created.'} Nothing from this drop was uploaded.`);
        return;
      } finally {
        setPreparing(false);
        if (made.length > 0) {
          setCreated((c) => [...c, ...made]);
          callbacks.current.onSetsChanged();
        }
      }
      for (const [folder, name] of plan.create) setOf.set(folder, made.find((m) => m.name === name)!.id);
    }
    const groups = new Map<string, DroppedFile[]>();
    for (const file of files) {
      const target = (file.set !== null && setOf.get(file.set)) || set.id;
      groups.set(target, [...(groups.get(target) ?? []), file]);
    }
    for (const [target, group] of groups) uploader.add(group, { galleryId, setId: target, options });
  };

  return (
    <section aria-label="Upload" className="flex flex-col gap-3">
      {unfinished > 0 && !snapshot.running && (
        <div role="status" className="rounded-card border border-line bg-surface px-4 py-3">
          <Text as="p" size="body-sm" weight="semibold" tone="alert">
            {plural(unfinished, 'photo', 'photos')} did not finish uploading. Drop the same files again to finish them; unfinished uploads are removed after 24 hours.
          </Text>
        </div>
      )}
      {mark === 'invalid' && (
        <Text as="p" size="body-sm" tone="danger" role="alert">
          This gallery’s watermark cannot be read, so photos cannot be uploaded. Create the gallery again.
        </Text>
      )}
      {dropError && (
        <Text as="p" size="body-sm" tone="danger" role="alert">
          {dropError}
        </Text>
      )}
      <DropZone onFiles={(files) => void onFiles(files)} disabled={!options || !set || preparing} />
      {set && <Caption>Loose photos go into “{set.name}”; photos in a folder go into the set named after it.</Caption>}
      <UploadPanel snapshot={snapshot} now={now} onCancel={uploader.cancel} onRetry={uploader.retryFailed} onClear={uploader.clear} />
    </section>
  );
}
