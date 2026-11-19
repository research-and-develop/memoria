import { MAX_UPLOAD_BYTES, type MediaType } from '@repo/platform/media';

import type { Size as Quality } from '@/lib/settings/parseGalleryDefaultsInput';
import type { Watermark } from '@/lib/settings/parseWatermarkInput';

import { createOffscreenCanvas, release, type CreateCanvas, type Surface } from './canvas';
import { encode, type ConvertToBlob, type DerivativeExt } from './encode';
import type { PhotoMeta } from './metadata/read';
import { stripMetadata } from './metadata/strip';
import { placeholderColor } from './placeholder';
import { MAX_MEGAPIXELS } from './probe';
import type { FileRefusal } from './refusals';
import { drawResized, targetSize } from './resize';
import { sniffImageType } from './sniff';

/**
 * One file through the pipeline (plan p05 D5.5), as the upload worker runs it: sniff, hash the file
 * as dropped, remove the location (D5.6), decode the cleaned bytes upright, draw the display copy and
 * the thumbnail, take the placeholder colour, bake the watermark, encode. The browser APIs come in as
 * `deps`, so the order of the steps is tested with fakes; the real ones are Verification 3.
 *
 * Memory: one decoded bitmap at a time, closed as soon as the display copy is drawn; every canvas
 * released before returning.
 */

/** The gallery's processing profile (D5.4) as the pipeline needs it, plus where the watermark image loads from. */
export type ProcessOptions = {
  display: Quality;
  thumb: Quality;
  watermark: Watermark | null;
  /** The watermark image's URL (public media domain or the dev read route); null for text or none. */
  watermarkUrl: string | null;
};

export type Derivative = { blob: Blob; width: number; height: number };

export type ProcessedPhoto = {
  original: Blob;
  originalType: MediaType;
  /** Hex SHA-256 of the file as dropped (D5.9: dedupe and resume). */
  sha256: string;
  /** Upright pixel size of the original (`photos.width`/`height`). */
  width: number;
  height: number;
  takenAt: string | null;
  meta: PhotoMeta;
  color: string;
  ext: DerivativeExt;
  derivativeType: 'image/webp' | 'image/jpeg';
  display: Derivative;
  thumb: Derivative;
};

export type ProcessResult = { ok: true; photo: ProcessedPhoto } | { ok: false; refusal: FileRefusal };

export type Decoded = { width: number; height: number; close(): void };

export type ProcessDeps = {
  /** `createImageBitmap(blob, { imageOrientation: 'from-image' })`: EXIF orientation applied. */
  decode: (blob: Blob) => Promise<Decoded>;
  sha256: (bytes: Uint8Array) => Promise<string>;
  /** Draws the watermark onto a canvas, or null for an unwatermarked gallery. */
  watermark: ((canvas: Surface) => void) | null;
  /** `jpg` once this browser has shown it cannot encode WebP. */
  format?: DerivativeExt;
  createCanvas?: CreateCanvas;
  convertToBlob?: ConvertToBlob;
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function processFile(file: Blob & { name?: string }, options: ProcessOptions, deps: ProcessDeps): Promise<ProcessResult> {
  const refuse = (refusal: FileRefusal): ProcessResult => ({ ok: false, refusal });
  if (file.size > MAX_UPLOAD_BYTES) return refuse({ code: 'too-large' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes, file.name ?? '');
  if (typeof type !== 'string') return refuse({ code: 'unsupported', kind: type.unsupported });
  const sha256 = await deps.sha256(bytes);
  const clean = stripMetadata(bytes, type);
  if (!clean.ok) return refuse({ code: clean.reason });
  if ((clean.width * clean.height) / 1_000_000 > MAX_MEGAPIXELS) return refuse({ code: 'too-many-pixels' });

  const original = new Blob([clean.bytes as Uint8Array<ArrayBuffer>], { type });
  const createCanvas = deps.createCanvas ?? createOffscreenCanvas;
  let bitmap: Decoded;
  try {
    bitmap = await deps.decode(original);
  } catch {
    return refuse({ code: 'decode' });
  }

  const canvases: Surface[] = [];
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    let display: Surface;
    try {
      display = drawResized(bitmap as unknown as ImageBitmap, targetSize(width, height, options.display.longEdge), createCanvas);
      canvases.push(display);
    } finally {
      bitmap.close();
    }
    const thumb = drawResized(display, targetSize(display.width, display.height, options.thumb.longEdge), createCanvas);
    canvases.push(thumb);
    const color = placeholderColor(thumb, createCanvas);
    if (deps.watermark) {
      deps.watermark(display);
      deps.watermark(thumb);
    }
    const encoding = { createCanvas, convertToBlob: deps.convertToBlob };
    const displayBlob = await encode(display, options.display.quality, { ...encoding, format: deps.format ?? 'webp' });
    const thumbBlob = await encode(thumb, options.thumb.quality, { ...encoding, format: displayBlob.ext });
    return {
      ok: true,
      photo: {
        original,
        originalType: type,
        sha256,
        width,
        height,
        takenAt: clean.exif.takenAt,
        meta: clean.exif.meta,
        color,
        ext: displayBlob.ext,
        derivativeType: displayBlob.type,
        display: { blob: displayBlob.blob, width: display.width, height: display.height },
        thumb: { blob: thumbBlob.blob, width: thumb.width, height: thumb.height },
      },
    };
  } finally {
    canvases.forEach(release);
  }
}
