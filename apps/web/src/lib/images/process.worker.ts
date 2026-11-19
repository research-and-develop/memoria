/**
 * The upload worker (plan p05 D5.5): a module Web Worker that runs `processFile` for each message from
 * the pool (`pool.ts` protocol). One file at a time; the pool decides how many workers run.
 * Created by `createImagePool` (`imagePool.ts`) with `new Worker(new URL('./process.worker.ts',
 * import.meta.url), { type: 'module' })`, which the Next bundler turns into its own chunk.
 */
import type { Watermark } from '@/lib/settings/parseWatermarkInput';

import type { Surface } from './canvas';
import type { DerivativeExt } from './encode';
import type { ImageJob } from './imagePool';
import type { WorkerReply } from './pool';
import { processFile, sha256Hex, type ProcessResult } from './process';
import { applyWatermark, loadWatermarkAssets, type WatermarkAssets } from './watermark';

type Scope = {
  onmessage: ((event: MessageEvent<{ id: number; input: ImageJob }>) => void) | null;
  postMessage(message: WorkerReply<ProcessResult>): void;
};
const scope = self as unknown as Scope;

/** Learned once per worker: after one PNG-for-WebP answer, go straight to JPEG. */
let format: DerivativeExt = 'webp';
/** One decoded watermark per (URL, display size) for the worker's lifetime. */
const watermarks = new Map<string, Promise<WatermarkAssets>>();

function watermarkAssets(watermark: Watermark, url: string | null, maxLongEdge: number): Promise<WatermarkAssets> {
  const key = `${url ?? ''}|${maxLongEdge}`;
  let assets = watermarks.get(key);
  if (!assets) {
    assets = loadWatermarkAssets(watermark, url, { maxLongEdge });
    assets.catch(() => watermarks.delete(key)); // a failed fetch is retried with the next photo
    watermarks.set(key, assets);
  }
  return assets;
}

async function run({ file, options }: ImageJob): Promise<ProcessResult> {
  const mark = options.watermark && options.watermark.kind !== 'none' ? options.watermark : null;
  const assets = mark ? await watermarkAssets(mark, options.watermarkUrl, options.display.longEdge) : null;
  const result = await processFile(file, options, {
    decode: (blob) => createImageBitmap(blob, { imageOrientation: 'from-image' }),
    sha256: sha256Hex,
    watermark:
      mark && assets
        ? (canvas: Surface) => {
            const ctx = (canvas as unknown as OffscreenCanvas).getContext('2d');
            if (ctx) applyWatermark(ctx as unknown as Parameters<typeof applyWatermark>[0], { w: canvas.width, h: canvas.height }, mark, assets);
          }
        : null,
    format,
  });
  if (result.ok && result.photo.ext === 'jpg') format = 'jpg';
  return result;
}

scope.onmessage = (event) => {
  const { id, input } = event.data;
  run(input).then(
    (output) => scope.postMessage({ id, ok: true, output }),
    (error: unknown) => scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : 'processing failed' }),
  );
};
