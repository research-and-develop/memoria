import { describe, expect, it } from 'vitest';

import { IMAGE_MATTE } from '@repo/ui/theme/pipeline';

import type { Surface } from './canvas';
import { encode, type ConvertToBlob } from './encode';
import { fakeCanvasFactory } from './testing/fakeCanvas';

/** A fake `convertToBlob` that answers PNG for WebP (Safari) or encodes what was asked. */
function converter({ webp }: { webp: boolean }) {
  const calls: string[] = [];
  const convertToBlob: ConvertToBlob = async (canvas: Surface, options) => {
    calls.push(`${(canvas as { id?: number }).id ?? 'source'} ${options.type} q=${options.quality}`);
    const type = options.type === 'image/webp' && !webp ? 'image/png' : (options.type ?? 'image/png');
    return new Blob([new Uint8Array([1, 2, 3])], { type });
  };
  return { convertToBlob, calls };
}

const source = (): Surface & { id: number } => ({ id: 99, width: 40, height: 30, getContext: () => null });

describe('encode', () => {
  it('WebP when the browser encodes it', async () => {
    const { convertToBlob, calls } = converter({ webp: true });
    const { createCanvas, log } = fakeCanvasFactory();
    const result = await encode(source(), 82, { convertToBlob, createCanvas });
    expect(result).toMatchObject({ type: 'image/webp', ext: 'webp' });
    expect(calls).toEqual(['99 image/webp q=0.82']);
    expect(log).toEqual([]);
  });

  it('falls back to JPEG when WebP comes back as PNG, painted on white first', async () => {
    const { convertToBlob, calls } = converter({ webp: false });
    const { createCanvas, log, canvases } = fakeCanvasFactory();
    const result = await encode(source(), 75, { convertToBlob, createCanvas });
    expect(result).toMatchObject({ type: 'image/jpeg', ext: 'jpg' });
    expect(result.blob.type).toBe('image/jpeg');
    expect(calls).toEqual(['99 image/webp q=0.75', '1 image/jpeg q=0.75']);
    expect(log).toEqual([`c1.fillRect(0, 0, 40, 30) ${IMAGE_MATTE.hex}`, 'c1.drawImage(c99, 0, 0, 40, 30) smoothing=low']);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 }); // the flattened copy is released
  });

  it("format 'jpg' skips the WebP try (the thumbnail follows the display copy)", async () => {
    const { convertToBlob, calls } = converter({ webp: true });
    const { createCanvas } = fakeCanvasFactory();
    const result = await encode(source(), 70, { format: 'jpg', convertToBlob, createCanvas });
    expect(result.ext).toBe('jpg');
    expect(calls).toEqual(['1 image/jpeg q=0.7']);
  });

  it('refuses a browser that cannot encode JPEG either', async () => {
    const convertToBlob: ConvertToBlob = async () => new Blob([], { type: 'image/png' });
    await expect(encode(source(), 70, { convertToBlob, createCanvas: fakeCanvasFactory().createCanvas })).rejects.toThrow(/image\/png/);
  });
});
