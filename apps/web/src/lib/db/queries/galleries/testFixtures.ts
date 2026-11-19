import type { GalleryInsert } from './types';
import type { PhotoUpload } from '../photos/types';

/**
 * Test fixtures shared by the galleries, photo_sets and photos tests (test-only: imported by
 * `*.test.ts` files alone). Ids are fixed-shape UUIDs so failures read well.
 */
export const T0 = Date.parse('2026-11-19T10:00:00.000Z');
export const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

let seq = 0;
export const uuid = (prefix = '0'): string => {
  seq += 1;
  return `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

export function galleryInsert(over: Partial<GalleryInsert> = {}): GalleryInsert {
  const id = over.id ?? uuid('9a11e7');
  return {
    id,
    slug: `gallery-${id.slice(-10)}`,
    title: 'Maria & Jonas',
    shootDate: '2026-10-03',
    clientName: 'Maria',
    clientEmail: 'maria@example.com',
    purpose: 'selection',
    access: 'link',
    passwordSealed: null,
    delivery: 'public',
    settings: { sort: 'filename' },
    now: at(0),
    ...over,
  };
}

/**
 * A photo's placeholder colour (`#RRGGBB`, photo DATA, not a style: built from a number so the
 * no-raw-colors guard, which is about styling, has nothing to flag).
 */
export const PLACEHOLDER = `#${(0x7a6b5c).toString(16).toUpperCase()}`;

/** A sha256-shaped hex string unique per call. */
export const hash = (n: number): string => n.toString(16).padStart(64, '0');

let hashSeq = 0;
export function photoUpload(galleryId: string, setId: string, over: Partial<PhotoUpload> = {}): PhotoUpload {
  hashSeq += 1;
  return {
    id: uuid('9d0705'),
    galleryId,
    setId,
    filename: `IMG_${String(hashSeq).padStart(4, '0')}.jpg`,
    nameKey: `img_${String(hashSeq).padStart(10, '0')}.jpg`,
    takenKey: '~',
    contentType: 'image/jpeg',
    originalBytes: 5_000_000,
    bytes: 5_600_000,
    width: 6000,
    height: 4000,
    takenAt: null,
    sha256: hash(1_000_000 + hashSeq),
    rev: 'abcd2345',
    derivativeExt: 'webp',
    displayWidth: 1600,
    displayHeight: 1067,
    color: PLACEHOLDER,
    processing: { display: { longEdge: 1600, quality: 75 }, thumb: { longEdge: 800, quality: 70 }, watermark: null, ext: 'webp' },
    meta: { camera: 'X-T5' },
    now: at(0),
    ...over,
  };
}
