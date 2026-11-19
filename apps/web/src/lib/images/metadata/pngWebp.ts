import { ascii, startsWith } from './bytes';
import { refuse } from './refusal';

/**
 * PNG and WebP in M2 (plan p05 D5.6): a file without metadata chunks is accepted unchanged; one
 * carrying EXIF, XMP or text chunks is refused (`metadata`: "export as JPEG, or without metadata")
 * until M4 ships their editors. ICC profiles are not metadata. Broken structure → `unreadable`.
 */

export const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';
/** PNG chunks that carry EXIF, XMP (an `iTXt` keyword) or free text. */
export const PNG_METADATA_CHUNKS: ReadonlySet<string> = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);
/** WebP chunks that carry EXIF or XMP. */
export const WEBP_METADATA_CHUNKS: ReadonlySet<string> = new Set(['EXIF', 'XMP ']);

type Size = { width: number; height: number };

const u32be = (b: Uint8Array, at: number) => (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
const u32le = (b: Uint8Array, at: number) => (((b[at + 3] ?? 0) << 24) | ((b[at + 2] ?? 0) << 16) | ((b[at + 1] ?? 0) << 8) | (b[at] ?? 0)) >>> 0;
const u24le = (b: Uint8Array, at: number) => ((b[at + 2] ?? 0) << 16) | ((b[at + 1] ?? 0) << 8) | (b[at] ?? 0);

/** Every chunk type of a PNG, in order, up to IEND. */
export function pngChunks(bytes: Uint8Array): string[] {
  if (!startsWith(bytes, PNG_SIGNATURE)) refuse('unreadable', 'no PNG signature');
  const types: string[] = [];
  let pos = 8;
  for (;;) {
    if (pos + 12 > bytes.length) return refuse('unreadable', 'truncated PNG');
    const length = u32be(bytes, pos);
    const type = ascii(bytes, pos + 4, 4);
    const end = pos + 12 + length;
    if (end > bytes.length) return refuse('unreadable', `PNG chunk ${type} outside the file`);
    types.push(type);
    if (type === 'IEND') return types;
    pos = end;
  }
}

/** Every chunk fourcc of a WebP (inside RIFF). */
export function webpChunks(bytes: Uint8Array): string[] {
  if (!startsWith(bytes, 'RIFF') || !startsWith(bytes, 'WEBP', 8)) refuse('unreadable', 'no WebP header');
  const end = Math.min(bytes.length, 8 + u32le(bytes, 4));
  if (8 + u32le(bytes, 4) > bytes.length) refuse('unreadable', 'truncated WebP');
  const types: string[] = [];
  let pos = 12;
  while (pos < end) {
    if (pos + 8 > end) return refuse('unreadable', 'truncated WebP chunk');
    const size = u32le(bytes, pos + 4);
    const next = pos + 8 + size + (size % 2);
    if (pos + 8 + size > end) return refuse('unreadable', 'WebP chunk outside the file');
    types.push(ascii(bytes, pos, 4));
    pos = next;
  }
  if (types.length === 0) refuse('unreadable', 'empty WebP');
  return types;
}

/** Refuse a PNG or WebP that carries metadata; return its size otherwise. */
export function checkPngWebp(bytes: Uint8Array, type: 'image/png' | 'image/webp'): Size {
  const chunks = type === 'image/png' ? pngChunks(bytes) : webpChunks(bytes);
  const metadata = type === 'image/png' ? PNG_METADATA_CHUNKS : WEBP_METADATA_CHUNKS;
  const found = chunks.filter((c) => metadata.has(c));
  if (found.length > 0) refuse('metadata', `chunks ${found.join(', ')}`);
  const size = type === 'image/png' ? pngSize(bytes) : webpSize(bytes);
  if (!size) return refuse('unreadable', 'no image size');
  return size;
}

/** The size in a PNG's IHDR (the first chunk). */
export function pngSize(bytes: Uint8Array): Size | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || !startsWith(bytes, 'IHDR', 12) || bytes.length < 24) return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The canvas size of a WebP from its first chunk: VP8X, VP8 (lossy) or VP8L (lossless). */
export function webpSize(bytes: Uint8Array): Size | null {
  if (!startsWith(bytes, 'RIFF') || !startsWith(bytes, 'WEBP', 8) || bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  const data = 20;
  if (chunk === 'VP8X') return { width: u24le(bytes, data + 4) + 1, height: u24le(bytes, data + 7) + 1 };
  if (chunk === 'VP8L') {
    if (bytes[data] !== 0x2f) return null;
    const bits = u32le(bytes, data + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
    const width = ((bytes[data + 6] ?? 0) | ((bytes[data + 7] ?? 0) << 8)) & 0x3fff;
    const height = ((bytes[data + 8] ?? 0) | ((bytes[data + 9] ?? 0) << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}
