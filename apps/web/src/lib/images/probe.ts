import { MAX_UPLOAD_BYTES, type MediaType } from '@repo/platform/media';

import { jpegSize } from './metadata/jpeg';
import { pngSize, webpSize } from './metadata/pngWebp';
import type { FileRefusal } from './refusals';
import { sniffImageType } from './sniff';

/**
 * What the page checks before a file reaches a worker (plan p05 D5.5): its type from the bytes, its
 * size, and its pixel count from the header — so a file over 100 MB or 100 megapixels is refused
 * before decoding, and the pool can budget decoded megapixels without decoding anything.
 */

export const MAX_MEGAPIXELS = 100;
/** Enough for the frame header behind a camera's EXIF, XMP and ICC segments; else the whole file is read. */
export const PROBE_BYTES = 512 * 1024;

export type Probe = { ok: true; type: MediaType; width: number; height: number; megapixels: number } | { ok: false; refusal: FileRefusal };

/** Pure: the head of a file (or all of it), its name and its full size. `null` = the head was too short. */
export function probeBytes(head: Uint8Array, name: string, size: number): Probe | null {
  if (size > MAX_UPLOAD_BYTES) return { ok: false, refusal: { code: 'too-large' } };
  const type = sniffImageType(head, name);
  if (typeof type !== 'string') return { ok: false, refusal: { code: 'unsupported', kind: type.unsupported } };
  const dims = type === 'image/jpeg' ? jpegSize(head) : type === 'image/png' ? pngSize(head) : webpSize(head);
  if (!dims) return head.length >= size ? { ok: false, refusal: { code: 'unreadable' } } : null;
  const megapixels = (dims.width * dims.height) / 1_000_000;
  if (megapixels > MAX_MEGAPIXELS) return { ok: false, refusal: { code: 'too-many-pixels' } };
  return { ok: true, type, ...dims, megapixels };
}

export async function probeFile(file: Blob & { name?: string }): Promise<Probe> {
  const read = async (end: number) => new Uint8Array(await file.slice(0, end).arrayBuffer());
  const name = file.name ?? '';
  return probeBytes(await read(PROBE_BYTES), name, file.size) ?? probeBytes(await read(file.size), name, file.size) ?? { ok: false, refusal: { code: 'unreadable' } };
}
