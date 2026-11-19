import 'server-only';

import { batch, type Options } from '@repo/db/client';
import { logger } from '@repo/logger';

import { constantTimeEqual } from '@/lib/auth/crypto';
import { hitRateLimitStatement } from '@/lib/db/queries/rate_limits';
import { securityNotices } from '@/lib/email/notices';
import { nudgeRelay } from '@/lib/jobs/enqueue';
import { windowStart, type RateRule } from '@/lib/security/rateLimit';

/**
 * The password gate's limits and comparison (plan p06 D6.10). The route
 * (`app/api/g/[slug]/access/route.ts`) runs them in this order: same-origin → `GATE_IP_RULE` (counted,
 * cheap, before Turnstile) → Turnstile → `gateFailureRule` (checked, not counted) → `passwordsMatch` →
 * on a wrong password `recordGateFailure`. There is NO hard lock on the gallery: an attacker could
 * otherwise shut the client out; the daily count tells the photographer instead (one notice a day).
 */

/** Every POST from an IP (/64 for IPv6, `ipKey`): 30 a minute. */
export const GATE_IP_RULE = (ipKey: string): RateRule => ({ bucket: `gallery-gate:ip:${ipKey}`, limit: 30, windowSeconds: 60 });

/** Wrong passwords from an IP for a gallery: 10 per 15 minutes, then 429. */
export const gateFailureRule = (ipKey: string, galleryId: string): RateRule => ({
  bucket: `gallery-gate:fail:${ipKey}:${galleryId}`,
  limit: 10,
  windowSeconds: 15 * 60,
});

/** Wrong passwords for a gallery at its password version in a UTC day: the notice at the threshold. */
export const GATE_DAILY_NOTICE_AT = 200;
export const gateDailyRule = (galleryId: string, passwordVersion: number): RateRule => ({
  bucket: `gallery-gate:day:${galleryId}:${passwordVersion}`,
  limit: GATE_DAILY_NOTICE_AT,
  windowSeconds: 24 * 3600,
});

const encoder = new TextEncoder();

/**
 * HMAC both under `key`, then a constant-time comparison of the two 32-byte MACs: the time taken
 * reveals neither how much matched nor the stored password's length.
 */
export async function passwordsMatch(key: CryptoKey, supplied: string, stored: string): Promise<boolean> {
  const [a, b] = await Promise.all([crypto.subtle.sign('HMAC', key, encoder.encode(supplied)), crypto.subtle.sign('HMAC', key, encoder.encode(stored))]);
  return constantTimeEqual(new Uint8Array(a), new Uint8Array(b));
}

/**
 * Counts a wrong password (the IP's and the gallery's daily bucket, one batch). The attempt whose
 * daily count reaches the threshold — exactly one, the upsert returns the new count — logs
 * `gallery_gate_suspicious` and queues the `security.gallery-gate` notice (the gallery title only),
 * conditioned on the count still being there. Returns the daily count.
 */
export async function recordGateFailure(
  input: { ipKey: string; galleryId: string; passwordVersion: number; title: string; now: Date },
  opts?: Options,
): Promise<number> {
  const failure = gateFailureRule(input.ipKey, input.galleryId);
  const daily = gateDailyRule(input.galleryId, input.passwordVersion);
  const dailyWindow = windowStart(input.now, daily.windowSeconds);
  const [, dailyResult] = await batch<{ count: number }>(
    [hitRateLimitStatement(failure.bucket, windowStart(input.now, failure.windowSeconds)), hitRateLimitStatement(daily.bucket, dailyWindow)],
    opts,
  );
  const count = dailyResult?.rows[0]?.count ?? 0;
  if (count === GATE_DAILY_NOTICE_AT) {
    logger.warn({ event: 'gallery_gate_suspicious', galleryId: input.galleryId });
    const notice = (await securityNotices(opts))(
      'security.gallery-gate',
      { at: input.now.toISOString(), gallery: input.title },
      {
        now: input.now,
        when: { sql: 'EXISTS (SELECT 1 FROM rate_limits WHERE bucket = ? AND window_start = ? AND count >= ?)', params: [daily.bucket, dailyWindow, GATE_DAILY_NOTICE_AT] },
      },
    );
    if (notice) {
      await batch([notice], opts);
      nudgeRelay();
    }
  }
  return count;
}
