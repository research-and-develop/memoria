import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { Surface } from './canvas';
import type { ConvertToBlob } from './encode';
import { base, cameraJpeg, containsBytes, pngChunk, pngWith, SECRETS } from './fixtures';
import { processFile, sha256Hex, type ProcessDeps, type ProcessOptions } from './process';
import { fakeCanvasFactory } from './testing/fakeCanvas';

const OPTIONS: ProcessOptions = { display: { longEdge: 1600, quality: 75 }, thumb: { longEdge: 800, quality: 70 }, watermark: null, watermarkUrl: null };

/** Fakes for the browser APIs: a decoder that reports a size, recording canvases, a converter. */
function deps(opts: { decoded?: { width: number; height: number }; webp?: boolean; decodeFails?: boolean } = {}) {
  const { createCanvas, log, canvases } = fakeCanvasFactory([200, 100, 50, 255]);
  const events: string[] = [];
  const decodedBlobs: Blob[] = [];
  const convertToBlob: ConvertToBlob = async (canvas, options) => {
    events.push(`encode c${(canvas as { id?: number }).id} ${options.type}`);
    const type = options.type === 'image/webp' && opts.webp === false ? 'image/png' : options.type!;
    return new Blob([new Uint8Array(8)], { type });
  };
  const value: ProcessDeps = {
    decode: async (blob) => {
      decodedBlobs.push(blob);
      if (opts.decodeFails) throw new Error('EncodingError');
      const size = opts.decoded ?? { width: 4000, height: 6000 };
      return { ...size, close: () => events.push('bitmap closed') };
    },
    sha256: sha256Hex,
    watermark: (canvas: Surface) => events.push(`watermark ${canvas.width}x${canvas.height}`),
    createCanvas,
    convertToBlob,
  };
  return { deps: value, events, log, canvases, decodedBlobs };
}

const asFile = (bytes: Uint8Array, name: string) => new File([bytes as Uint8Array<ArrayBuffer>], name);

describe('processFile', () => {
  it('a camera JPEG: hash of the dropped file, location removed, upright sizes, derivatives watermarked and encoded', async () => {
    const input = cameraJpeg({ orientation: 6 });
    const { deps: d, events, canvases, decodedBlobs } = deps({ decoded: { width: 4000, height: 6000 } });
    const result = await processFile(asFile(input, 'IMG_0001.JPG'), OPTIONS, d);
    if (!result.ok) throw new Error(result.refusal.code);
    const photo = result.photo;

    expect(photo.sha256).toBe(createHash('sha256').update(input).digest('hex'));
    expect(photo.originalType).toBe('image/jpeg');
    const original = new Uint8Array(await photo.original.arrayBuffer());
    expect(containsBytes(original, SECRETS.makerNote)).toBe(false);
    expect(containsBytes(original, SECRETS.xmp)).toBe(false);
    // the browser decodes exactly the bytes that are stored
    expect(new Uint8Array(await decodedBlobs[0]!.arrayBuffer())).toEqual(original);

    expect(photo).toMatchObject({
      width: 4000,
      height: 6000,
      takenAt: '2026-06-14T15:42:07',
      meta: { camera: 'Canon EOS R5', iso: 400 },
      color: '#c86432',
      ext: 'webp',
      derivativeType: 'image/webp',
      display: { width: 1067, height: 1600 },
      thumb: { width: 534, height: 800 },
    });
    expect(events).toEqual(['bitmap closed', 'watermark 1067x1600', 'watermark 534x800', `encode c${canvases[1]!.id} image/webp`, `encode c${canvases[2]!.id} image/webp`]);
    expect(canvases.every((c) => c.width === 0)).toBe(true); // every canvas released
  });

  it('the thumbnail is drawn from the display copy before the watermark, and the placeholder before both', async () => {
    const { deps: d, log, events } = deps({ decoded: { width: 6000, height: 4000 } });
    await processFile(asFile(base.jpeg(), 'a.jpg'), OPTIONS, d);
    // c1 = halving, c2 = display, c3 = thumb (from c2), c4 = placeholder (from c3)
    expect(log.filter((l) => l.includes('drawImage'))).toEqual([
      'c1.drawImage(source 6000x4000, 0, 0, 3000, 2000) smoothing=high',
      'c2.drawImage(c1, 0, 0, 1600, 1067) smoothing=high',
      'c3.drawImage(c2, 0, 0, 800, 534) smoothing=high',
      'c4.drawImage(c3, 0, 0, 8, 5) smoothing=high',
    ]);
    expect(events.indexOf('watermark 1600x1067')).toBeGreaterThan(-1);
  });

  it('no watermark: nothing drawn on top', async () => {
    const { deps: d, events } = deps();
    await processFile(asFile(base.jpeg(), 'a.jpg'), OPTIONS, { ...d, watermark: null });
    expect(events.some((e) => e.startsWith('watermark'))).toBe(false);
  });

  it('JPEG derivatives where WebP is not encoded; the thumbnail follows without trying WebP', async () => {
    const { deps: d, events } = deps({ webp: false });
    const result = await processFile(asFile(base.jpeg(), 'a.jpg'), OPTIONS, d);
    expect(result).toMatchObject({ ok: true, photo: { ext: 'jpg', derivativeType: 'image/jpeg' } });
    expect(events.filter((e) => e.startsWith('encode')).map((e) => e.split(' ')[2])).toEqual(['image/webp', 'image/jpeg', 'image/jpeg']);
  });

  it("format 'jpg' (learned by the worker) skips the WebP try", async () => {
    const { deps: d, events } = deps();
    await processFile(asFile(base.jpeg(), 'a.jpg'), OPTIONS, { ...d, format: 'jpg' });
    expect(events.filter((e) => e.startsWith('encode')).map((e) => e.split(' ')[2])).toEqual(['image/jpeg', 'image/jpeg']);
  });

  it('a small photo is never upscaled', async () => {
    const { deps: d } = deps({ decoded: { width: 24, height: 16 } });
    const result = await processFile(asFile(base.jpeg(), 'a.jpg'), OPTIONS, d);
    expect(result).toMatchObject({ ok: true, photo: { width: 24, height: 16, display: { width: 24, height: 16 }, thumb: { width: 24, height: 16 } } });
  });

  it.each([
    ['a HEIC', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63]), 'IMG.HEIC', { code: 'unsupported', kind: 'heic' }],
    ['a PNG with text metadata', pngWith([pngChunk('tEXt', new TextEncoder().encode('Comment\0Sofia'))]), 'a.png', { code: 'metadata' }],
    ['a truncated JPEG', base.jpeg().subarray(0, 300), 'a.jpg', { code: 'unreadable' }],
  ])('%s is refused before decoding', async (_, bytes, name, refusal) => {
    const { deps: d, decodedBlobs } = deps();
    expect(await processFile(asFile(bytes, name), OPTIONS, d)).toEqual({ ok: false, refusal });
    expect(decodedBlobs).toHaveLength(0);
  });

  it('a file the browser cannot decode', async () => {
    const { deps: d } = deps({ decodeFails: true });
    expect(await processFile(asFile(base.jpeg(), 'a.jpg'), OPTIONS, d)).toEqual({ ok: false, refusal: { code: 'decode' } });
  });

  it('over 100 MB is refused without reading it', async () => {
    const huge = { size: 100 * 1024 * 1024 + 1, name: 'huge.jpg', arrayBuffer: () => Promise.reject(new Error('read')) } as unknown as File;
    expect(await processFile(huge, OPTIONS, deps().deps)).toEqual({ ok: false, refusal: { code: 'too-large' } });
  });

  it('over 100 megapixels (from the frame header) is refused before decoding', async () => {
    const jpeg = base.jpeg();
    const sof = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xc0);
    jpeg.set([0x30, 0xd4, 0x30, 0xd4], sof + 5); // 12500 × 12500
    const { deps: d, decodedBlobs } = deps();
    expect(await processFile(asFile(jpeg, 'big.jpg'), OPTIONS, d)).toEqual({ ok: false, refusal: { code: 'too-many-pixels' } });
    expect(decodedBlobs).toHaveLength(0);
  });
});
