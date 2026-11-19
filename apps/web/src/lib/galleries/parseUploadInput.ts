import { isUuid } from '@repo/core/validation';
import { isMediaType, MAX_UPLOAD_BYTES, type MediaType } from '@repo/platform/media';

import { cleanText } from './parseGalleryInput';

/**
 * The register and complete requests of a photo upload (plan p05 D5.8, the Routes table). Pure.
 * Everything here is what the browser CLAIMS; the complete request checks the stored objects with
 * `head()` against these numbers, because a presigned PUT cannot enforce a size.
 */

/** Photos per register request (≤ 100 parameters per INSERT, ≤ 30 signatures). */
export const REGISTER_BATCH = 10;
/** Photos per complete request: 3 `head()`s each + ~4 D1 calls stay inside 50 subrequests. */
export const COMPLETE_BATCH = 8;
/** A derivative (thumbnail or display copy) is never larger than this. */
export const MAX_DERIVATIVE_BYTES = 10 * 1024 * 1024;
/** = the pipeline's refusal (D5.5): more pixels than this is refused before decoding. */
export const MAX_PIXELS = 100_000_000;
export const META_MAX = 2048;

export type UploadPhotoInput = {
  filename: string;
  contentType: MediaType;
  sha256: string;
  bytes: { original: number; thumb: number; display: number };
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  derivativeExt: 'webp' | 'jpg';
  takenAt: string | null;
  color: string;
  meta: Record<string, unknown>;
};

export type RegisterInput = { setId: string; photos: UploadPhotoInput[] };

type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; message: string };
const fail = (field: string, message: string) => ({ ok: false as const, field, message });
const record = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

const TAKEN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function photo(input: unknown, i: number): Parsed<UploadPhotoInput> {
  const p = record(input);
  const at = (field: string) => `photos.${i}.${field}`;
  if (!p) return fail(at('photo'), 'Each photo must be an object.');
  if (typeof p.filename !== 'string') return fail(at('filename'), 'A photo needs its filename.');
  const filename = cleanText(p.filename);
  if (!filename || [...filename].length > 255) return fail(at('filename'), 'A filename is 1–255 characters.');
  if (!isMediaType(p.contentType)) return fail(at('contentType'), 'Only JPEG, PNG and WebP photos can be uploaded.');
  if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) return fail(at('sha256'), 'Invalid content hash.');
  const bytes = record(p.bytes);
  if (!bytes || !int(bytes.original, 1, MAX_UPLOAD_BYTES)) return fail(at('bytes'), 'The photo is too large (100 MB at most).');
  if (!int(bytes.thumb, 1, MAX_DERIVATIVE_BYTES) || !int(bytes.display, 1, MAX_DERIVATIVE_BYTES)) return fail(at('bytes'), 'Invalid preview sizes.');
  if (!int(p.width, 1, 100_000) || !int(p.height, 1, 100_000) || p.width * p.height > MAX_PIXELS) return fail(at('width'), 'Invalid photo dimensions.');
  if (!int(p.displayWidth, 1, 4096) || !int(p.displayHeight, 1, 4096)) return fail(at('displayWidth'), 'Invalid preview dimensions.');
  if (p.derivativeExt !== 'webp' && p.derivativeExt !== 'jpg') return fail(at('derivativeExt'), 'Previews are WebP or JPEG.');
  const takenAt = p.takenAt ?? null;
  if (takenAt !== null && (typeof takenAt !== 'string' || !TAKEN_RE.test(takenAt))) return fail(at('takenAt'), 'Invalid capture time.');
  if (typeof p.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(p.color)) return fail(at('color'), 'Invalid placeholder colour.');
  const meta = p.meta === undefined ? {} : record(p.meta);
  if (!meta || JSON.stringify(meta).length > META_MAX) return fail(at('meta'), 'Invalid photo details.');
  return {
    ok: true,
    value: {
      filename,
      contentType: p.contentType,
      sha256: p.sha256,
      bytes: { original: bytes.original, thumb: bytes.thumb as number, display: bytes.display as number },
      width: p.width,
      height: p.height as number,
      displayWidth: p.displayWidth,
      displayHeight: p.displayHeight as number,
      derivativeExt: p.derivativeExt,
      takenAt,
      color: p.color,
      meta,
    },
  };
}

export function parseRegisterInput(body: unknown): Parsed<RegisterInput> {
  const input = record(body) ?? {};
  if (typeof input.setId !== 'string' || !isUuid(input.setId)) return fail('setId', 'Choose the set to upload into.');
  if (!Array.isArray(input.photos) || input.photos.length === 0 || input.photos.length > REGISTER_BATCH) {
    return fail('photos', `Register 1–${REGISTER_BATCH} photos at a time.`);
  }
  const photos: UploadPhotoInput[] = [];
  for (const [i, raw] of input.photos.entries()) {
    const parsed = photo(raw, i);
    if (!parsed.ok) return parsed;
    photos.push(parsed.value);
  }
  if (new Set(photos.map((p) => p.sha256)).size !== photos.length) return fail('photos', 'The same file appears twice in one request.');
  return { ok: true, value: { setId: input.setId, photos } };
}

export function parseCompleteInput(body: unknown): Parsed<{ photoIds: string[] }> {
  const input = record(body) ?? {};
  const ids = input.photoIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > COMPLETE_BATCH || !ids.every((id) => typeof id === 'string' && isUuid(id))) {
    return fail('photoIds', `Complete 1–${COMPLETE_BATCH} photos at a time.`);
  }
  return { ok: true, value: { photoIds: [...new Set(ids as string[])] } };
}
