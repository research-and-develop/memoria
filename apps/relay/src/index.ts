/**
 * The relay Worker (plan p03): runs background jobs, never serves the public.
 *
 * - `fetch`: only `POST /run` (the app's nudge through its RELAY service binding) → 202 at once;
 *   the drain continues in `waitUntil`. Anything else → 404.
 * - `scheduled`: the Cron Trigger (every minute) → the drain, awaited.
 *
 * Email leaves through the transport the mail settings name (lib/settings/mail.ts): SMTP over
 * `cloudflare:sockets`, the HTTPS providers over `fetch`; SMTP's QUIT runs in `waitUntil`.
 *
 * It builds the platform and nothing else: the work lives in the shared domain code
 * (apps/web/src/lib/**), which reaches this invocation's platform through
 * `@repo/platform/current` → packages/platform-cloudflare/relay.ts (wrangler.jsonc `alias`).
 * Guard `relay-graph` keeps Next, React and OpenNext out of everything this file reaches.
 */
import { logger } from '@repo/logger';
import { mailerForTransport } from '@repo/platform/mail/transport';
import { cloudflarePlatform } from '@repo/platform-cloudflare/platform';
import { withPlatform } from '@repo/platform-cloudflare/relay';
import { cloudflareSmtpConnect } from '@repo/platform-cloudflare/smtp';

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
      await runDueJobs({
        trigger: run.trigger,
        mailerFor: (transport) =>
          mailerForTransport(transport, { smtpConnect: cloudflareSmtpConnect, fetch: (url, init) => fetch(url, init), background: (task) => ctx.waitUntil(task) }),
      });
    } catch (error) {
      logger.error({ event: 'relay_drain_failed', trigger: run.trigger, message: error instanceof Error ? error.message : String(error) });
    }
  });
}
