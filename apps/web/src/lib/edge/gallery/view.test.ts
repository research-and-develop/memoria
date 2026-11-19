import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublicGalleryRow } from '../../db/queries/galleries/public';
import { PUBLIC_PHOTO_PAGE, type PublicPhotoRow } from '../../db/queries/photos/public';
import { decodeCursor } from '../../galleries/sortKey';
import { GALLERY_LOCALE, GALLERY_TIME_ZONE, galleryGateView, galleryPageView, viewPage, viewSets, viewStudio } from './view';

const ID = '9a11e700-0000-4000-8000-000000000001';
const SET = '5e700000-0000-4000-8000-000000000001';
const COLOR = `#${(0x7a6b5c).toString(16)}`;

function galleryRow(over: Partial<PublicGalleryRow> = {}): PublicGalleryRow {
  return {
    id: ID,
    slug: 'maria-jonas-k7x2qpm4rt',
    title: 'Maria & Jonas',
    shoot_date: '2026-10-03',
    purpose: 'selection',
    status: 'published',
    access: 'link',
    password_version: 1,
    delivery: 'public',
    settings: { theme: 'dark', accent: 'pine', font: 'modern', grid: 'justified', sort: 'taken', welcome: 'Hello' },
    content_version: 4,
    cover: { id: 'c', w: 1600, h: 1067, color: COLOR, rev: 'abcd2345', ext: 'webp' },
    ...over,
  };
}

const photo = (n: number, over: Partial<PublicPhotoRow> = {}): PublicPhotoRow => ({
  id: `p${n}`,
  w: 1600,
  h: 1067,
  color: COLOR,
  rev: 'abcd2345',
  ext: 'webp',
  sort_key: `k${String(n).padStart(4, '0')}`,
  ...over,
});

const deepKeys = (value: unknown): string[] =>
  value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...deepKeys(v)]) : [];

afterEach(() => vi.restoreAllMocks());

describe('galleryPageView', () => {
  it('carries the gallery, its look and the page; nothing a client must not see', () => {
    const studio = viewStudio({ name: 'North Light', siteUrl: 'https://north.example' }, 'Memoria');
    const view = galleryPageView({
      gallery: galleryRow(),
      studio,
      mediaBaseUrl: 'https://media.example.test',
      sets: viewSets([{ id: SET, name: 'Ceremony', photo_count: 2 }]),
      page: viewPage(SET, [photo(1), photo(2)]),
    });
    expect(view).toEqual({
      v: 1,
      kind: 'gallery',
      gallery: {
        id: ID,
        slug: 'maria-jonas-k7x2qpm4rt',
        title: 'Maria & Jonas',
        date: '2026-10-03',
        purpose: 'selection',
        welcome: 'Hello',
        cover: { id: 'c', w: 1600, h: 1067, color: COLOR, rev: 'abcd2345', ext: 'webp' },
        theme: 'dark',
        accent: 'pine',
        font: 'modern',
        grid: 'justified',
        sort: 'taken',
        protect: true,
      },
      studio: { name: 'North Light', website: 'https://north.example', locale: GALLERY_LOCALE, timeZone: GALLERY_TIME_ZONE },
      media: 'https://media.example.test',
      sets: [{ id: SET, name: 'Ceremony', count: 2 }],
      page: { setId: SET, photos: [['p1', 1600, 1067, COLOR, 'abcd2345', 'webp'], ['p2', 1600, 1067, COLOR, 'abcd2345', 'webp']], next: null },
    });
    const keys = deepKeys(view);
    for (const banned of ['password_sealed', 'password', 'client_name', 'client_email', 'filename', 'status', 'access']) expect(keys).not.toContain(banned);
    expect(JSON.stringify(view)).not.toContain('original');
  });

  it('protects selection galleries only (the right-click deterrent)', () => {
    const view = (purpose: 'selection' | 'sharing') => galleryPageView({ gallery: galleryRow({ purpose }), studio: viewStudio(null, 'M'), mediaBaseUrl: null, sets: [], page: null });
    expect(view('selection').gallery.protect).toBe(true);
    expect(view('sharing').gallery.protect).toBe(false);
  });

  it('reads invalid or unknown settings as their defaults, and logs the invalid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const view = galleryPageView({
      gallery: galleryRow({ settings: { theme: 'neon', accent: 'no-such-swatch', font: 'Bad Font!', grid: 3 } }),
      studio: viewStudio(null, 'M'),
      mediaBaseUrl: null,
      sets: [],
      page: null,
    });
    expect(view.gallery).toMatchObject({ theme: 'auto', accent: 'pine', font: 'classic', grid: 'masonry', sort: 'filename', welcome: '' });
    expect(JSON.stringify(warn.mock.calls)).toContain('gallery_settings_invalid');
  });

  it('drops a cover with a bad rev or extension', () => {
    const bad = galleryPageView({
      gallery: galleryRow({ cover: { id: 'c', w: 1, h: 1, color: COLOR, rev: 'BAD', ext: 'webp' } }),
      studio: viewStudio(null, 'M'),
      mediaBaseUrl: null,
      sets: [],
      page: null,
    });
    expect(bad.gallery.cover).toBeNull();
  });
});

describe('galleryGateView', () => {
  it('has the title, look and studio only: no photos, no cover, no id', () => {
    const view = galleryGateView({ gallery: galleryRow({ access: 'password' }), studio: viewStudio(null, 'Memoria'), turnstileSiteKey: 'site' });
    expect(view).toEqual({
      v: 1,
      kind: 'gate',
      gallery: { slug: 'maria-jonas-k7x2qpm4rt', title: 'Maria & Jonas', theme: 'dark', accent: 'pine', font: 'modern' },
      studio: { name: 'Memoria', website: null, locale: GALLERY_LOCALE, timeZone: GALLERY_TIME_ZONE },
      turnstileSiteKey: 'site',
    });
    expect(deepKeys(view)).not.toEqual(expect.arrayContaining(['cover']));
  });
});

describe('viewPage', () => {
  it('drops (and logs) a row with a bad rev or extension, keeping the order', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const page = viewPage(SET, [photo(1), photo(2, { rev: 'abc' }), photo(3, { ext: 'png' as never }), photo(4)]);
    expect(page.photos.map((p) => p[0])).toEqual(['p1', 'p4']);
    expect(JSON.stringify(warn.mock.calls)).toContain('gallery_photo_invalid');
  });

  it('a full page plus one row → the next cursor is the last returned sort_key', () => {
    const rows = Array.from({ length: PUBLIC_PHOTO_PAGE + 1 }, (_, i) => photo(i));
    const page = viewPage(SET, rows);
    expect(page.photos).toHaveLength(PUBLIC_PHOTO_PAGE);
    expect(decodeCursor(page.next ?? '')).toBe(rows[PUBLIC_PHOTO_PAGE - 1]?.sort_key);
    expect(viewPage(SET, rows.slice(0, PUBLIC_PHOTO_PAGE)).next).toBeNull();
  });
});

describe('viewStudio', () => {
  it.each([
    ['a studio row', { name: 'North Light', siteUrl: 'https://north.example' }, { name: 'North Light', website: 'https://north.example' }],
    ['no row', null, { name: 'Memoria', website: null }],
    ['an invalid row', { name: '' }, { name: 'Memoria', website: null }],
    ['no website', { name: 'North Light', siteUrl: null }, { name: 'North Light', website: null }],
  ])('%s', (_label, value, expected) => {
    expect(viewStudio(value, 'Memoria')).toMatchObject(expected);
  });
});
