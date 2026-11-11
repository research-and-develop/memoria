import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse, type NextRequest } from 'next/server';

import { forbiddenError, jsonError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { logger } from '@repo/logger';

import { parseContactInput } from '@/lib/contact/parseContactInput';
import { storeContactMessage } from '@/lib/contact/submit';
import { hitRateLimits, ipKey, pruneRateLimits } from '@/lib/security/rateLimit';
import { clientIp, isSameOrigin } from '@/lib/security/request';
import { verifyTurnstile } from '@/lib/turnstile/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per IP 5 messages an hour; overall 200 a day — a flood cannot exhaust the free D1 writes. */
const RULES = (key: string) => [
  { bucket: `contact:ip:${key}`, limit: 5, windowSeconds: 60 * 60 },
  { bucket: 'contact:global', limit: 200, windowSeconds: 24 * 60 * 60 },
];

/**
 * The public write endpoint — the reference for any other. Every refusal
 * happens BEFORE anything is written: same-origin → parse → honeypot →
 * Turnstile → rate limit → store → 201. Housekeeping runs after the response
 * (`ctx.waitUntil`; a floating promise would be cancelled).
 */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    if (!isSameOrigin(req)) return forbiddenError({ reason: 'cross_origin' });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Honeypot: a filled hidden field = a bot. Answer like a success, store nothing.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      logger.info({ event: 'contact_honeypot' });
      return NextResponse.json({ data: { id: null } }, { status: 201 });
    }

    const parsed = parseContactInput(body);
    if (!parsed.ok) {
      const [field, message] = Object.entries(parsed.errors)[0] ?? ['', 'Invalid input.'];
      return jsonError(400, { error: 'Invalid parameters', errorCode: 'INVALID_PARAMS', details: { field, message, errors: parsed.errors } });
    }

    const { env, ctx } = getCloudflareContext();
    const ip = clientIp(req);
    const turnstile = await verifyTurnstile({
      token: body.turnstileToken,
      secret: env.TURNSTILE_SECRET_KEY,
      action: 'contact',
      remoteIp: ip,
      hostname: new URL(req.url).hostname,
    });
    if (!turnstile.ok) {
      return jsonError(400, {
        error: 'Turnstile failed',
        errorCode: 'TURNSTILE_FAILED',
        details: { message: 'The security check failed. Please try again.', reason: turnstile.reason },
      });
    }

    const limit = await hitRateLimits(RULES(await ipKey(ip, env.HASH_SALT ?? '')));
    if (limit.limited) {
      logger.warn({ event: 'contact_rate_limited' });
      return tooManyRequestsError(limit.retryAfterSeconds, 'You have sent several messages already. Please try again later.');
    }

    const { id } = await storeContactMessage(parsed.value);
    // Ids, never the submitter's name, email or message.
    logger.info({ event: 'contact_submitted', id });
    ctx.waitUntil(pruneRateLimits().catch((e: Error) => logger.warn({ event: 'rate_limit_prune_failed', message: e.message })));
    return NextResponse.json({ data: { id } }, { status: 201 });
  },
  { route: 'POST /api/contact' },
);
