/**
 * The relay Worker (plan p03): runs background jobs, never serves the public.
 *
 * - `fetch`: only `POST /run` (the app's nudge through its RELAY service binding) → 202 at once;
 *   the drain continues in `waitUntil`. Anything else → 404.
 * - `scheduled`: the Cron Trigger (every minute) → the drain, awaited.
 *
 * It builds the platform and nothing else: the work lives in the shared domain code
 * (apps/web/src/lib/**), which reaches this invocation's platform through
 * `@repo/platform/current` → packages/platform-cloudflare/relay.ts (wrangler.jsonc `alias`).
 * Guard `relay-graph` keeps Next, React and OpenNext out of everything this file reaches.
 */
import { logger } from '@repo/logger';
import { unconfiguredMailer } from '@repo/platform/mail/unconfigured';
import { cloudflarePlatform } from '@repo/platform-cloudflare/platform';
import { withPlatform } from '@repo/platform-cloudflare/relay';

import { enqueuePeriodicJobs } from '@/lib/jobs/periodic';
import { runDueJobs, type DrainTrigger } from '@/lib/jobs/runner';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/run') return new Response(null, { status: 404 });
    ctx.waitUntil(drain(env, ctx, { trigger: 'nudge' }));
    return new Response(null, { status: 202 });
  },
  async scheduled(controller, env, ctx) {
    await drain(env, ctx, { trigger: 'cron', scheduledAt: new Date(controller.scheduledTime) });
  },
} satisfies ExportedHandler<RelayEnv>;

async function drain(env: RelayEnv, ctx: ExecutionContext, run: { trigger: DrainTrigger; scheduledAt?: Date }): Promise<void> {
  const platform = cloudflarePlatform(env, (task) => ctx.waitUntil(task));
  await withPlatform(platform, async () => {
    try {
      // The periodic date is the cron's scheduled time; claims and leases use the real clock.
      if (run.scheduledAt) await enqueuePeriodicJobs(run.scheduledAt);
      // Commit 3 (plan p03, T3.8) builds the mailer from the mail settings.
      await runDueJobs({ mailer: unconfiguredMailer('email is not set up yet'), trigger: run.trigger });
    } catch (error) {
      logger.error({ event: 'relay_drain_failed', trigger: run.trigger, message: error instanceof Error ? error.message : String(error) });
    }
  });
}
