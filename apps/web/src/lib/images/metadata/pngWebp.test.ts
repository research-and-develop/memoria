import { describe, expect, it } from 'vitest';

import { base, buildTiff, cameraExif, pngChunk, pngText, pngWith, simpleWebp, webpWith } from '../fixtures';
import { pngSize, webpSize } from './pngWebp';
import { stripMetadata } from './strip';

const enc = (s: string) => new TextEncoder().encode(s);
const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>';

describe('stripMetadata: PNG and WebP without metadata are accepted unchanged', () => {
  it.each([
    ['PNG', base.png(), 'image/png', 8, 6],
    ['PNG with an ICC profile chunk', pngWith([pngChunk('iCCP', enc('sRGB\0\0xyz'))]), 'image/png', 8, 6],
    ['WebP lossy (VP8)', simpleWebp('lossy'), 'image/webp', 8, 6],
    ['WebP lossless (VP8L)', simpleWebp('lossless'), 'image/webp', 8, 6],
    ['WebP extended with ICC (VP8X)', base.webpLossy(), 'image/webp', 8, 6],
    ['WebP extended lossless with alpha', base.webpLossless(), 'image/webp', 8, 6],
  ] as const)('%s', (_, input, type, width, height) => {
    const result = stripMetadata(input, type);
    expect(result).toMatchObject({ ok: true, width, height, exif: { orientation: 1, takenAt: null, meta: {} } });
    expect(result.ok && result.bytes).toBe(input);
  });
});

describe('stripMetadata: PNG and WebP carrying metadata are refused until M4', () => {
  const exif = buildTiff(cameraExif());
  it.each([
    ['PNG eXIf', pngWith([pngChunk('eXIf', exif)]), 'image/png'],
    ['PNG tEXt', pngWith([pngText('Comment', 'Sofia')]), 'image/png'],
    ['PNG zTXt', pngWith([pngChunk('zTXt', enc('Comment\0\0x'))]), 'image/png'],
    ['PNG iTXt (XMP)', pngWith([pngChunk('iTXt', enc(`XML:com.adobe.xmp\0\0\0\0\0${XMP}`))]), 'image/png'],
    ['WebP EXIF', webpWith({ exif }), 'image/webp'],
    ['WebP XMP', webpWith({ xmp: XMP }), 'image/webp'],
  ] as const)('%s → metadata', (_, input, type) => {
    expect(stripMetadata(input, type)).toMatchObject({ ok: false, reason: 'metadata' });
  });

  it.each([
    ['a truncated PNG', base.png().subarray(0, 60), 'image/png'],
    ['a PNG without IEND', base.png().subarray(0, base.png().length - 12), 'image/png'],
    ['a truncated WebP', base.webpLossy().subarray(0, 100), 'image/webp'],
    ['JPEG bytes called PNG', base.jpeg(), 'image/png'],
    ['PNG bytes called WebP', base.png(), 'image/webp'],
  ] as const)('%s → unreadable', (_, input, type) => {
    expect(stripMetadata(input, type)).toMatchObject({ ok: false, reason: 'unreadable' });
  });
});

describe('header sizes (read before decoding)', () => {
  it.each([
    ['PNG', pngSize(base.png())],
    ['VP8', webpSize(simpleWebp('lossy'))],
    ['VP8L', webpSize(simpleWebp('lossless'))],
    ['VP8X', webpSize(base.webpLossy())],
  ])('%s → 8 × 6', (_, size) => {
    expect(size).toEqual({ width: 8, height: 6 });
  });

  it('null for other bytes', () => {
    expect(pngSize(base.jpeg())).toBeNull();
    expect(webpSize(base.png())).toBeNull();
  });
});
