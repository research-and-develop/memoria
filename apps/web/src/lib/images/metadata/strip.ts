import type { MediaType } from '@repo/platform/media';

import { cleanJpeg } from './jpeg';
import { checkPngWebp } from './pngWebp';
import { NO_EXIF, readExif, type ExifInfo } from './read';
import { MetadataRefusal, type RefusalReason } from './refusal';

/**
 * Edit or refuse (plan p05 D5.6): the original as it will be stored — a JPEG rebuilt without its
 * location, a PNG or WebP unchanged when it carries no metadata — or the reason it is refused.
 * Pure (bytes in, bytes out); runs in the upload worker. Anything unexpected refuses: a bug in the
 * editor must never let a location through.
 */
export type StripResult =
  | { ok: true; bytes: Uint8Array; /** stored (unrotated) size */ width: number; height: number; exif: ExifInfo }
  | { ok: false; reason: RefusalReason; detail: string };

export function stripMetadata(bytes: Uint8Array, type: MediaType): StripResult {
  try {
    if (type === 'image/jpeg') {
      const clean = cleanJpeg(bytes);
      return { ok: true, bytes: clean.bytes, width: clean.width, height: clean.height, exif: clean.exif ? readExif(clean.exif) : NO_EXIF };
    }
    const size = checkPngWebp(bytes, type);
    return { ok: true, bytes, ...size, exif: NO_EXIF };
  } catch (error) {
    if (error instanceof MetadataRefusal) return { ok: false, reason: error.reason, detail: error.detail };
    return { ok: false, reason: 'location', detail: `unexpected: ${error instanceof Error ? error.name : 'error'}` };
  }
}
