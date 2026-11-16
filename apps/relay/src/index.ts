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
import { cloudflarePlatform } from '@repo/platform-cloudflare/platform';
import { withPlatform } from '@repo/platform-cloudflare/relay';

type Trigger = 'nudge' | 'cron';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/run') return new Response(null, { status: 404 });
    ctx.waitUntil(drain(env, ctx, 'nudge'));
    return new Response(null, { status: 202 });
  },
  async scheduled(_controller, env, ctx) {
    await drain(env, ctx, 'cron');
  },
} satisfies ExportedHandler<RelayEnv>;

async function drain(env: RelayEnv, ctx: ExecutionContext, trigger: Trigger): Promise<void> {
  const platform = cloudflarePlatform(env, (task) => ctx.waitUntil(task));
  await withPlatform(platform, async () => {
    try {
      // Commit 2 (plan p03, T3.5): expire leases, claim and run due jobs.
      logger.debug({ event: 'relay_drain', trigger });
    } catch (error) {
      logger.error({ event: 'relay_drain_failed', trigger, message: error instanceof Error ? error.message : String(error) });
    }
  });
}
