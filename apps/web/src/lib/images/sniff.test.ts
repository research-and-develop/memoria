import { describe, expect, it } from 'vitest';

import { base, simpleWebp } from './fixtures';
import { sniffImageType } from './sniff';

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));
const ftyp = (major: string, ...compatible: string[]) => {
  const size = 16 + 4 * compatible.length;
  return bytes([0, 0, 0, size], 'ftyp', major, [0, 0, 0, 0], ...compatible);
};

describe('sniffImageType', () => {
  it.each([
    ['JPEG (real)', base.jpeg(), 'image/jpeg'],
    ['JPEG (EXIF first)', bytes([0xff, 0xd8, 0xff, 0xe1, 0, 0x10]), 'image/jpeg'],
    ['PNG', base.png(), 'image/png'],
    ['WebP lossy (VP8)', simpleWebp('lossy'), 'image/webp'],
    ['WebP lossless (VP8L)', simpleWebp('lossless'), 'image/webp'],
    ['WebP extended (VP8X)', base.webpLossy(), 'image/webp'],
  ] as const)('%s → %s', (_, input, expected) => {
    expect(sniffImageType(input)).toBe(expected);
  });

  it.each([
    ['HEIC', ftyp('heic', 'mif1', 'heic'), '', 'heic'],
    ['HEIF (mif1 + heic)', ftyp('mif1', 'mif1', 'heic'), 'IMG_0001.HEIC', 'heic'],
    ['AVIF', ftyp('avif', 'mif1', 'avif'), '', 'other'],
    ['TIFF (little-endian)', bytes('II*', [0], [8, 0, 0, 0]), 'scan.tif', 'tiff'],
    ['TIFF (big-endian)', bytes('MM', [0], '*', [0, 0, 0, 8]), '', 'tiff'],
    ['CR2', bytes('II*', [0], [16, 0, 0, 0], 'CR', [2, 0]), '', 'raw'],
    ['NEF (a TIFF to its bytes; the name says raw)', bytes('MM', [0], '*', [0, 0, 0, 8]), 'DSC_0001.NEF', 'raw'],
    ['DNG', bytes('II*', [0], [8, 0, 0, 0]), 'photo.dng', 'raw'],
    ['CR3', ftyp('crx ', 'crx ', 'isom'), '', 'raw'],
    ['ORF', bytes('IIRO', [8, 0, 0, 0]), '', 'raw'],
    ['RW2', bytes('IIU', [0], [8, 0, 0, 0]), '', 'raw'],
    ['RAF', bytes('FUJIFILMCCD-RAW 0201'), '', 'raw'],
    ['GIF', bytes('GIF89a', [1, 0, 1, 0]), '', 'gif'],
    ['MP4', ftyp('isom', 'isom', 'avc1', 'mp41'), 'clip.mp4', 'video'],
    ['MOV', ftyp('qt  ', 'qt  '), '', 'video'],
    ['AVI', bytes('RIFF', [0, 0, 0, 0], 'AVI LIST'), '', 'video'],
    ['MKV / WebM', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]), '', 'video'],
    ['text', bytes('hello, world'), 'notes.txt', 'other'],
    ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.svg', 'other'],
    ['a JPEG name on other bytes', bytes('<html>'), 'photo.jpg', 'other'],
    ['empty', new Uint8Array(), '', 'other'],
  ] as const)('%s → unsupported %s', (_, input, name, kind) => {
    expect(sniffImageType(input, name)).toEqual({ unsupported: kind });
  });

  it('a raw extension never makes JPEG bytes unacceptable', () => {
    expect(sniffImageType(base.jpeg(), 'IMG_0001.CR2')).toBe('image/jpeg');
  });
});
