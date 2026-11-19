import type { CreateCanvas, Painter, Surface } from '../canvas';

/**
 * A recording fake of the canvas slice (`canvas.ts`) for the pipeline's pure cores: every call is
 * logged as `<canvas id>.<call>`, and `getImageData` answers with a fixed colour. Test-only.
 */
export type FakeCanvas = Surface & { id: number; calls: string[] };

export function fakeCanvasFactory(pixel: [number, number, number, number] = [10, 20, 30, 255]) {
  const log: string[] = [];
  const canvases: FakeCanvas[] = [];
  let next = 0;
  const createCanvas: CreateCanvas = (width, height) => {
    const id = ++next;
    const calls: string[] = [];
    const record = (call: string) => {
      calls.push(call);
      log.push(`c${id}.${call}`);
    };
    const ctx: Painter = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillStyle: '',
      drawImage: (image, dx, dy, dw, dh) => record(`drawImage(${describe(image)}, ${dx}, ${dy}, ${dw}, ${dh}) smoothing=${ctx.imageSmoothingQuality}`),
      fillRect: (x, y, w, h) => record(`fillRect(${x}, ${y}, ${w}, ${h}) ${String(ctx.fillStyle)}`),
      getImageData: (_x, _y, w, h) => {
        record(`getImageData(${w}, ${h})`);
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) data.set(pixel, i);
        return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
      },
    };
    const canvas: FakeCanvas = { id, width, height, calls, getContext: () => ctx };
    canvases.push(canvas);
    return canvas;
  };
  return { createCanvas, log, canvases };
}

function describe(image: unknown): string {
  const source = image as { id?: number; width: number; height: number };
  return source.id ? `c${source.id}` : `source ${source.width}x${source.height}`;
}
