import { logger } from '@repo/logger';
import { parseConfig } from '@repo/platform/config';
import type { Platform } from '@repo/platform/ports';

import { d1Db } from './d1';
import { stringEnv } from './env';
import { r2BlobStore } from './r2';

/**
 * The Cloudflare platform, built from a Worker's own `env` and `waitUntil`. No OpenNext import:
 * Next code reaches it through `@repo/platform/current` (./next.ts); a Worker entry outside Next
 * (worker.ts, the Phase 3 relay) calls this constructor with its `env` and `ctx.waitUntil`.
 */
export type CloudflarePlatformEnv = { DB: D1Database; MEDIA: R2Bucket };

export function cloudflarePlatform(env: CloudflarePlatformEnv, waitUntil: (task: Promise<unknown>) => void): Platform {
  const db = d1Db(env.DB);
  const blobs = r2BlobStore(env.MEDIA);
  return {
    name: 'cloudflare',
    db: () => db,
    blobs: () => blobs,
    // Parsed per call: a handful of string reads, and never stale.
    config: () => parseConfig(stringEnv(env)),
    defer(task) {
      waitUntil(
        task.catch((error: unknown) => {
          logger.error({ event: 'deferred_task_failed', message: error instanceof Error ? error.message : String(error) });
        }),
      );
    },
  };
}
