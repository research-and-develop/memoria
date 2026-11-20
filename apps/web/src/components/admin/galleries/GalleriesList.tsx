'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { buttonClassName, Button } from '@repo/ui/button';
import { DateText } from '@repo/ui/date';
import { Card, Pill } from '@repo/ui/layout';
import { Segmented } from '@repo/ui/segmented';
import { Caption, Heading, Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';
import type { GalleryCard } from '@/lib/galleries/galleries';

import { adminFetch } from './adminFetch';

type Page = GalleryCard[];
const FILTERS = [
  { value: 'live', label: 'Galleries' },
  { value: 'deleted', label: 'Deleted' },
] as const;

/**
 * The galleries grid (plan p05 → Screens): cards with the cover, title, status, purpose, count and
 * date, 50 a page from `GET /api/admin/galleries` (*Load more*); the *Deleted* filter shows the
 * soft-deleted ones, each with the date it is removed for good and *Restore* (D5.17).
 */
export function GalleriesList() {
  const [filter, setFilter] = useState<'live' | 'deleted'>('live');
  const [cards, setCards] = useState<Page>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A page with its `next` (outside `data`, which `useApi` unwraps): a plain fetch of the envelope.
  const fetchPage = useCallback(async (cursor: string | null, deleted: boolean, signal?: AbortSignal) => {
    const query = new URLSearchParams({ ...(deleted ? { deleted: '1' } : {}), ...(cursor ? { cursor } : {}) });
    const res = await fetch(`/api/admin/galleries?${query}`, { signal });
    const body = (await res.json().catch(() => ({}))) as { data?: Page; next?: string | null; error?: string };
    if (!res.ok || !body.data) throw new Error(body.error ?? 'The galleries could not be loaded. Try again.');
    return { cards: body.data, next: body.next ?? null };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    setError(null);
    fetchPage(null, filter === 'deleted', controller.signal).then(
      (page) => {
        setCards(page.cards);
        setNext(page.next);
        setLoaded(true);
      },
      (e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => controller.abort();
  }, [fetchPage, filter]);

  async function more() {
    if (!next) return;
    setLoading(true);
    try {
      const page = await fetchPage(next, filter === 'deleted');
      setCards((previous) => [...previous, ...page.cards]);
      setNext(page.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Segmented options={FILTERS} value={filter} onValueChange={setFilter} aria-label="Which galleries" className="w-fit" />
      <FormNote message={error} />
      {loaded && cards.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 p-6">
          <Heading level={2} size="title">
            {filter === 'deleted' ? 'Nothing deleted' : 'No galleries yet'}
          </Heading>
          {filter === 'live' ? (
            <>
              <Text tone="muted">Create a gallery, upload a shoot, and share it with your client.</Text>
              <Link href="/admin/galleries/new" className={buttonClassName({ variant: 'primary' })}>
                New gallery
              </Link>
            </>
          ) : (
            <Text tone="muted">Deleted galleries stay here for 7 days before they are removed for good.</Text>
          )}
        </Card>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <li key={card.id}>
            <GalleryCardView card={card} onRestored={() => setCards((all) => all.filter((c) => c.id !== card.id))} />
          </li>
        ))}
      </ul>
      {next ? (
        <Button variant="secondary" onClick={() => void more()} disabled={loading} className="self-center">
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function GalleryCardView({ card, onRestored }: { card: GalleryCard; onRestored: () => void }) {
  const body = (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="aspect-[3/2] bg-wash">
        {card.coverUrl ? <img src={card.coverUrl} alt="" loading="lazy" className="size-full object-cover" /> : null}
      </div>
      <div className="flex flex-col gap-1.5 p-4">
        <span className="flex items-start justify-between gap-2">
          <Text weight="semibold" className="min-w-0 break-words">
            {card.title}
          </Text>
          {card.deletedAt ? <Pill tone="expired">Deleted</Pill> : <Pill tone={card.status === 'published' ? 'live' : 'draft'}>{card.status === 'published' ? 'Live' : 'Draft'}</Pill>}
        </span>
        <Caption>
          {card.purpose === 'selection' ? 'Selection' : 'Sharing'} · {card.photoCount} {card.photoCount === 1 ? 'photo' : 'photos'}
          {card.shootDate ? (
            <>
              {' · '}
              <DateText value={card.shootDate} />
            </>
          ) : null}
        </Caption>
        {card.purgeAt ? <RestoreRow galleryId={card.id} purgeAt={card.purgeAt} onRestored={onRestored} /> : null}
      </div>
    </Card>
  );
  if (card.deletedAt) return body;
  return (
    <Link href={`/admin/galleries/${card.id}`} className="block h-full rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      {body}
    </Link>
  );
}

/** A deleted gallery: when it goes for good, and *Restore* until then (D5.17). */
function RestoreRow({ galleryId, purgeAt, onRestored }: { galleryId: string; purgeAt: string; onRestored: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <Caption>
        Removed for good on <DateText value={purgeAt} />.
      </Caption>
      <FormNote message={error} />
      <div>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const result = await adminFetch(`/api/admin/galleries/${galleryId}/restore`, { method: 'POST', body: {} });
            setBusy(false);
            setError(result.ok ? null : result.error);
            if (result.ok) onRestored();
          }}
        >
          Restore
        </Button>
      </div>
    </div>
  );
}
