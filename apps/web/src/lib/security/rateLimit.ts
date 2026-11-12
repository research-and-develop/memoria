import 'server-only';

import { batch, run, type Options } from '@repo/db/client';
import { logger } from '@repo/logger';

import { hmacSha256Hex } from '@/lib/auth/crypto';
import { deleteOldRateLimitsStatement, hitRateLimitStatement } from '@/lib/db/queries/rate_limits';

/**
 * Fixed-window rate limits on D1. Each rule is a bucket + a limit per window;
 * `hit` counts the request in every bucket in ONE batch (atomic upserts) and
 * says whether any bucket went over. Count first, decide after: two
 * concurrent requests can never both slip under the limit.
 */
export type RateRule = { bucket: string; limit: number; windowSeconds: number };

export function windowStart(now: Date, windowSeconds: number): string {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms).toISOString();
}

export async function hitRateLimits(
  rules: RateRule[],
  opts?: Options & { now?: Date },
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const now = opts?.now ?? new Date();
  const results = await batch<{ count: number }>(
    rules.map((r) => hitRateLimitStatement(r.bucket, windowStart(now, r.windowSeconds))),
    opts,
  );
  let retryAfterSeconds = 0;
  rules.forEach((rule, i) => {
    const count = results[i]?.rows[0]?.count ?? 0;
    if (count > rule.limit) {
      const windowEnd = Date.parse(windowStart(now, rule.windowSeconds)) + rule.windowSeconds * 1000;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((windowEnd - now.getTime()) / 1000));
    }
  });
  return { limited: retryAfterSeconds > 0, retryAfterSeconds };
}

/** Forget windows older than two days (run in `waitUntil` now and then). */
export function pruneRateLimits(opts?: Options & { now?: Date }): Promise<unknown> {
  const now = opts?.now ?? new Date();
  return run(deleteOldRateLimitsStatement(new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString()), opts);
}

/**
 * A visitor's IP as a bucket key: an HMAC with the secret salt AND the day, so
 * a stored key cannot be turned back into an IP and does not link visits
 * across days. Nothing else about the visitor is ever stored.
 */
export async function ipKey(ip: string, salt: string, now: Date = new Date()): Promise<string> {
  if (!salt) warnMissingSalt();
  return (await hmacSha256Hex(salt || 'unsalted', `${now.toISOString().slice(0, 10)}|${ip}`)).slice(0, 32);
}

/**
 * Without HASH_SALT the fallback is public (it is in this file), so a stored
 * key could be reversed by hashing every IPv4 address. Still rate-limit, but
 * say so — once per isolate, not per request.
 */
const SALT_WARNED_KEY = '__appHashSaltWarned';
function warnMissingSalt(): void {
  const holder = globalThis as unknown as Record<string, boolean | undefined>;
  if (holder[SALT_WARNED_KEY]) return;
  holder[SALT_WARNED_KEY] = true;
  logger.warn({ event: 'hash_salt_missing', hint: 'npx wrangler secret put HASH_SALT' });
}
