import type { MediaType } from '@repo/platform/media';

/**
 * What a dropped file is, decided by its bytes (plan p05 D5.5): JPEG, PNG and WebP are accepted, the
 * rest is reported with a reason the upload panel can name. A filename only refines the label of a
 * refusal (a Nikon `.nef` is a plain TIFF to its bytes); it never makes a file acceptable.
 *
 * Pure: reads the first bytes only (`SNIFF_BYTES` is enough).
 */

export type UnsupportedKind = 'heic' | 'tiff' | 'raw' | 'gif' | 'video' | 'other';
export type Sniffed = MediaType | { unsupported: UnsupportedKind };

/** How many leading bytes `sniffImageType` looks at. */
export const SNIFF_BYTES = 64;

const RAW_EXTENSIONS = new Set(['3fr', 'arw', 'cr2', 'cr3', 'crw', 'dcr', 'dng', 'erf', 'iiq', 'k25', 'kdc', 'mef', 'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'raf', 'raw', 'rw2', 'rwl', 'sr2', 'srf', 'srw', 'x3f']);
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

export function sniffImageType(bytes: Uint8Array, filename = ''): Sniffed {
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);

  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';

  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { unsupported: 'gif' };
  if (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') {
    // CR2 marks itself; NEF, ARW, DNG and the like are TIFF files to their bytes.
    if (ascii(8, 2) === 'CR' || RAW_EXTENSIONS.has(ext)) return { unsupported: 'raw' };
    return { unsupported: 'tiff' };
  }
  if (ascii(0, 4) === 'IIRO' || ascii(0, 4) === 'IIRS' || ascii(0, 4) === 'IIU\0' || ascii(0, 15) === 'FUJIFILMCCD-RAW') return { unsupported: 'raw' };
  if (ascii(4, 4) === 'ftyp') return { unsupported: isoBrandKind(bytes) };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'AVI ') return { unsupported: 'video' };
  if (starts(0x1a, 0x45, 0xdf, 0xa3) || starts(0x00, 0x00, 0x01, 0xba) || starts(0x00, 0x00, 0x01, 0xb3)) return { unsupported: 'video' };
  if (RAW_EXTENSIONS.has(ext)) return { unsupported: 'raw' };
  return { unsupported: 'other' };
}

/** An ISO base media file (`ftyp`): HEIC/HEIF, AVIF, Canon CR3, or a video (MP4, MOV, 3GP). */
function isoBrandKind(bytes: Uint8Array): UnsupportedKind {
  const size = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  const end = Math.min(bytes.length, Math.max(16, size >>> 0));
  const brands: string[] = [];
  // major brand at 8, minor version at 12, compatible brands from 16
  for (const at of [8, ...range(16, end, 4)]) {
    if (at + 4 <= bytes.length) brands.push(String.fromCharCode(...bytes.subarray(at, at + 4)));
  }
  if (brands.includes('crx ')) return 'raw';
  if (brands.some((b) => AVIF_BRANDS.has(b))) return 'other';
  if (brands.some((b) => HEIF_BRANDS.has(b))) return 'heic';
  return 'video';
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let i = from; i + step <= to; i += step) out.push(i);
  return out;
}
