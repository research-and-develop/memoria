'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@repo/ui/button';
import { twMerge } from '@repo/ui/cn';
import { Caption, Text } from '@repo/ui/typography';

import { adminFetch } from './adminFetch';

export type ManagerPhoto = {
  id: string;
  filename: string;
  width: number;
  height: number;
  color: string;
  hidden: boolean;
  status: 'uploading' | 'ready' | 'deleted';
  thumbUrl: string | null;
};

/**
 * One set's photos (plan p05 → Screens, D5.14): pages of 200 from the API, thumbs at their aspect
 * ratio on the placeholder colour, lazily loaded; a checkbox per ready photo; *Cover* and *Hidden*
 * badges. `version` changes whenever the parent wants a reload (after a bulk action or an upload).
 */
export function PhotoGrid({
  galleryId,
  setId,
  coverId,
  version,
  selected,
  onSelectedChange,
}: {
  galleryId: string;
  setId: string;
  coverId: string | null;
  version: number;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  const [photos, setPhotos] = useState<ManagerPhoto[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const page = useCallback(
    (cursor: string | null, signal?: AbortSignal) =>
      adminFetch<ManagerPhoto[]>(`/api/admin/galleries/${galleryId}/photos?${new URLSearchParams({ set_id: setId, ...(cursor ? { cursor } : {}) })}`, { signal }),
    [galleryId, setId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    void page(null, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setPhotos(result.data);
        setNext((result.body.next as string | null) ?? null);
        setError(null);
      } else {
        setError(result.error);
      }
      setLoaded(true);
    });
    return () => controller.abort();
  }, [page, version]);

  async function more() {
    if (!next) return;
    const result = await page(next);
    if (result.ok) {
      setPhotos((previous) => [...previous, ...result.data]);
      setNext((result.body.next as string | null) ?? null);
    } else setError(result.error);
  }

  const toggle = (id: string) => {
    const nextSelected = new Set(selected);
    if (nextSelected.has(id)) nextSelected.delete(id);
    else nextSelected.add(id);
    onSelectedChange(nextSelected);
  };

  if (error) return <Text tone="danger">{error}</Text>;
  if (loaded && photos.length === 0) return <Caption>No photos in this set yet.</Caption>;

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {photos.map((photo) => {
          const isSelected = selected.has(photo.id);
          const ready = photo.status === 'ready';
          return (
            <li key={photo.id}>
              <label
                className={twMerge(
                  'relative block overflow-hidden rounded-control ring-offset-2 ring-offset-ground',
                  ready && 'cursor-pointer',
                  isSelected && 'ring-2 ring-focus',
                )}
                style={{ aspectRatio: `${photo.width} / ${photo.height}`, backgroundColor: photo.color }}
              >
                {photo.thumbUrl ? <img src={photo.thumbUrl} alt={photo.filename} loading="lazy" className={twMerge('size-full object-cover', photo.hidden && 'opacity-50')} /> : null}
                {ready ? (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(photo.id)}
                    aria-label={`Select ${photo.filename}`}
                    className="absolute left-2 top-2 size-5 accent-accent"
                  />
                ) : null}
                <span className="absolute bottom-2 left-2 flex gap-1">
                  {photo.id === coverId ? <Badge>Cover</Badge> : null}
                  {photo.hidden ? <Badge>Hidden</Badge> : null}
                  {photo.status === 'uploading' ? <Badge>Unfinished</Badge> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {next ? (
        <Button variant="secondary" className="self-center" onClick={() => void more()}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-scrim/80 px-2 py-0.5 font-sans text-micro font-semibold text-inverse">{children}</span>;
}
