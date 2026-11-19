import { describe, expect, it } from 'vitest';

import { app1Exif, base, cameraExif, concatBytes, jpegWith, segment, simpleWebp } from './fixtures';
import { PROBE_BYTES, probeBytes, probeFile } from './probe';
import { refusalMessage, type FileRefusal } from './refusals';

const MB = 1024 * 1024;

describe('probeBytes', () => {
  it.each([
    ['JPEG', base.jpeg(), 'a.jpg', { ok: true, type: 'image/jpeg', width: 24, height: 16 }],
    ['camera JPEG (frame after EXIF)', jpegWith([app1Exif(cameraExif())]), 'a.jpg', { ok: true, type: 'image/jpeg', width: 24, height: 16 }],
    ['PNG', base.png(), 'a.png', { ok: true, type: 'image/png', width: 8, height: 6 }],
    ['WebP', simpleWebp('lossless'), 'a.webp', { ok: true, type: 'image/webp', width: 8, height: 6 }],
    ['GIF', new TextEncoder().encode('GIF89a....'), 'a.gif', { ok: false, refusal: { code: 'unsupported', kind: 'gif' } }],
  ] as const)('%s', (_, bytes, name, expected) => {
    expect(probeBytes(bytes, name, bytes.length)).toMatchObject(expected);
  });

  it('refuses over 100 MB before looking at the bytes', () => {
    expect(probeBytes(base.jpeg(), 'a.jpg', 100 * MB + 1)).toEqual({ ok: false, refusal: { code: 'too-large' } });
  });

  it('refuses over 100 megapixels from the header', () => {
    const jpeg = base.jpeg();
    const sof = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xc0);
    jpeg.set([0x27, 0x10, 0x27, 0x11], sof + 5); // 10001 × 10000
    expect(probeBytes(jpeg, 'a.jpg', jpeg.length)).toEqual({ ok: false, refusal: { code: 'too-many-pixels' } });
  });

  it('a head too short for the frame header asks for more; the whole file without one is unreadable', () => {
    const head = base.jpeg().subarray(0, 40);
    expect(probeBytes(head, 'a.jpg', 5000)).toBeNull();
    expect(probeBytes(head, 'a.jpg', 40)).toEqual({ ok: false, refusal: { code: 'unreadable' } });
  });
});

describe('probeFile', () => {
  it('reads the whole file when the frame header lies past the first 512 KB', async () => {
    const padding = Array.from({ length: Math.ceil(PROBE_BYTES / 65000) + 1 }, () => segment(0xe5, new Uint8Array(65000)));
    const jpeg = jpegWith(padding);
    expect(jpeg.length).toBeGreaterThan(PROBE_BYTES);
    const result = await probeFile(new File([jpeg as Uint8Array<ArrayBuffer>], 'big-header.jpg'));
    expect(result).toMatchObject({ ok: true, width: 24, height: 16 });
  });

  it('megapixels for the pool budget', async () => {
    const result = await probeFile(new File([concatBytes(base.jpeg()) as Uint8Array<ArrayBuffer>], 'a.jpg'));
    expect(result).toMatchObject({ ok: true, megapixels: (24 * 16) / 1e6 });
  });
});

describe('refusalMessage', () => {
  it.each<FileRefusal>([
    { code: 'unsupported', kind: 'heic' },
    { code: 'unsupported', kind: 'tiff' },
    { code: 'unsupported', kind: 'raw' },
    { code: 'unsupported', kind: 'gif' },
    { code: 'unsupported', kind: 'video' },
    { code: 'unsupported', kind: 'other' },
    { code: 'too-large' },
    { code: 'too-many-pixels' },
    { code: 'location' },
    { code: 'metadata' },
    { code: 'unreadable' },
    { code: 'decode' },
  ])('%j has a sentence', (refusal) => {
    expect(refusalMessage(refusal)).toMatch(/^[A-Z].+\.$/);
  });
});
