/**
 * The slice of the canvas API the pipeline uses, so the pure cores take fakes in tests (plan p05:
 * decoding and drawing themselves are Verification 3). `OffscreenCanvas` satisfies both.
 */
export type Painter = {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  fillStyle: string | CanvasGradient | CanvasPattern;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
};

export type Surface = {
  width: number;
  height: number;
  getContext(contextId: '2d'): Painter | null;
};

export type CreateCanvas = (width: number, height: number) => Surface;

export const createOffscreenCanvas: CreateCanvas = (width, height) => new OffscreenCanvas(width, height);

export function painter(canvas: Surface): Painter {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return ctx;
}

/** Release a canvas's pixels now rather than at the next GC (large photos, several workers). */
export function release(canvas: Surface): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** A surface drawn as an image source (an `OffscreenCanvas` or `ImageBitmap` at runtime). */
export const asSource = (surface: Surface | ImageBitmap): CanvasImageSource => surface as unknown as CanvasImageSource;
