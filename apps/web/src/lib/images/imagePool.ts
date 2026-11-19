import { createPool, type Pool, type WorkerLike } from './pool';
import type { ProcessOptions, ProcessResult } from './process';

/**
 * The upload pipeline's worker pool (plan p05 D5.5): `min(4, max(1, hardwareConcurrency − 1))`
 * module workers running `process.worker.ts`, at most 80 decoded megapixels in flight (dimensions
 * from `probeFile`, read before decoding; `navigator.deviceMemory` does not exist in Safari or
 * Firefox). Browser only.
 */

export const MAX_MEGAPIXELS_IN_FLIGHT = 80;

export type ImageJob = { file: File | Blob; options: ProcessOptions };

export type ImagePool = {
  process(file: File | Blob, options: ProcessOptions, run: { megapixels: number; signal?: AbortSignal }): Promise<ProcessResult>;
  destroy(): void;
};

export function poolSize(hardwareConcurrency: number | undefined): number {
  return Math.min(4, Math.max(1, (hardwareConcurrency || 2) - 1));
}

export function createImagePool({ size = poolSize(globalThis.navigator?.hardwareConcurrency) }: { size?: number } = {}): ImagePool {
  const pool: Pool<ImageJob, ProcessResult> = createPool(
    () => new Worker(new URL('./process.worker.ts', import.meta.url), { type: 'module', name: 'image-process' }) as unknown as WorkerLike,
    { size, maxWeight: MAX_MEGAPIXELS_IN_FLIGHT },
  );
  return {
    process: (file, options, { megapixels, signal }) => pool.run({ file, options }, { weight: megapixels, signal }),
    destroy: () => pool.destroy(),
  };
}
