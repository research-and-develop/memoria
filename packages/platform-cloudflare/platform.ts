import { logger } from '@repo/logger';
import { parseConfig } from '@repo/platform/config';
import type { Jobs, Platform } from '@repo/platform/ports';

import { d1Db } from './d1';
import { stringEnv } from './env';
import { r2BlobStore } from './r2';

/**
 * The Cloudflare platform, built from a Worker's own `env` and `waitUntil`. No OpenNext import:
 * Next code reaches it through `@repo/platform/current` (./next.ts); a Worker entry outside Next
 * (worker.ts, the Phase 3 relay) calls this constructor with its `env` and `ctx.waitUntil`.
 */
export type CloudflarePlatformEnv = {
  DB: D1Database;
  MEDIA: R2Bucket;
  /** The relay Worker's service binding (the app has it; the relay itself does not). Plan p03. */
  RELAY?: Fetcher;
};

export function cloudflarePlatform(env: CloudflarePlatformEnv, waitUntil: (task: Promise<unknown>) => void): Platform {
  const db = d1Db(env.DB);
  const blobs = r2BlobStore(env.MEDIA);
  const jobs = relayJobs(env.RELAY);
  return {
    name: 'cloudflare',
    db: () => db,
    blobs: () => blobs,
    // Parsed per call: a handful of string reads, and never stale.
    config: () => parseConfig(stringEnv(env)),
    jobs: () => jobs,
    defer(task) {
      waitUntil(
        task.catch((error: unknown) => {
          logger.error({ event: 'deferred_task_failed', message: error instanceof Error ? error.message : String(error) });
        }),
      );
    },
  };
}

/**
 * The nudge (plan p03, D3.4): `POST /run` to the relay through its service binding. The relay
 * answers 202 at once and drains in its own `waitUntil`. A hint only: a failure is logged and
 * swallowed (the relay's cron runs whatever a lost nudge missed). Without the binding (the relay
 * itself) it does nothing.
 */
export function relayJobs(relay: Fetcher | undefined): Jobs {
  return {
    async nudge() {
      if (!relay) return;
      try {
        const res = await relay.fetch('https://relay/run', { method: 'POST' });
        if (res.status >= 300) logger.warn({ event: 'relay_nudge_failed', status: res.status });
      } catch (error) {
        logger.warn({ event: 'relay_nudge_failed', message: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
