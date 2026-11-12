import { AppError } from '@repo/core/error';
import { logger } from '@repo/logger';
import { parseConfig } from '@repo/platform/config';
import type { Platform } from '@repo/platform/ports';

import { d1Db } from './d1';
import { stringEnv } from './env';

/**
 * The Cloudflare platform, built from a Worker's own `env` and `waitUntil`. No OpenNext import:
 * Next code reaches it through `@repo/platform/current` (./next.ts); a Worker entry outside Next
 * (worker.ts, the Phase 3 relay) calls this constructor with its `env` and `ctx.waitUntil`.
 */
export type CloudflarePlatformEnv = { DB: D1Database };

export function cloudflarePlatform(env: CloudflarePlatformEnv, waitUntil: (task: Promise<unknown>) => void): Platform {
  const db = d1Db(env.DB);
  return {
    name: 'cloudflare',
    db: () => db,
    blobs() {
      // R2 arrives with the MEDIA binding (Phase 1, commit 5).
      throw new AppError('Media storage is not configured.', 'MEDIA_NOT_CONFIGURED', { status: 503 });
    },
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
