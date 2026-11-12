import { NextResponse, type NextRequest } from 'next/server';

import { forbiddenError, invalidParamsError, jsonError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { AppError } from '@repo/core/error';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { constantTimeEqualStrings } from '@/lib/auth/crypto';
import { parseLoginInput } from '@/lib/auth/parseLoginInput';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, sessionCookie } from '@/lib/auth/session';
import { hitRateLimits, ipKey, pruneRateLimits } from '@/lib/security/rateLimit';
import { clientIp, isSameOrigin, isSecureRequest } from '@/lib/security/request';
import { verifyTurnstile } from '@/lib/turnstile/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per IP: 10 attempts / 15 min. Overall: 60 / hour (a distributed guess at the one account). */
const RULES = (key: string) => [
  { bucket: `login:ip:${key}`, limit: 10, windowSeconds: 15 * 60 },
  { bucket: 'login:global', limit: 60, windowSeconds: 60 * 60 },
];

const WRONG = 'Wrong email or password.';

/**
 * The admin login. Order matters: same-origin → parse → count
 * the attempt (rate limit) → Turnstile → credentials (email and password are
 * always both checked, so timing does not reveal which was wrong) → session.
 */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    if (!isSameOrigin(req)) return forbiddenError({ reason: 'cross_origin' });
    const body = await req.json().catch(() => ({}));
    const parsed = parseLoginInput(body);
    if (!parsed.ok) return invalidParamsError(parsed.message, parsed.field);

    const platform = getPlatform();
    const config = platform.config();
    const { email: adminEmail, passwordHash } = config.admin;
    if (!adminEmail || !passwordHash) {
      throw new AppError('Admin login is not configured', 'ADMIN_NOT_CONFIGURED', {
        status: 503,
        message: 'The admin sign-in is not configured yet.',
      });
    }

    const ip = clientIp(req);
    const limit = await hitRateLimits(RULES(await ipKey(ip, config.hashSalt)));
    if (limit.limited) {
      logger.warn({ event: 'admin_login_rate_limited' });
      return tooManyRequestsError(limit.retryAfterSeconds, 'Too many attempts. Try again in a few minutes.');
    }

    const turnstile = await verifyTurnstile({
      token: parsed.value.turnstileToken,
      secret: config.turnstile.secretKey,
      action: 'login',
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

    const emailOk = constantTimeEqualStrings(parsed.value.email, adminEmail);
    const passwordOk = await verifyPassword(parsed.value.password, passwordHash);
    if (!emailOk || !passwordOk) {
      logger.info({ event: 'admin_login_failed' });
      return jsonError(401, { error: 'Unauthorized', errorCode: 'INVALID_CREDENTIALS', details: { message: WRONG } });
    }

    const { token, session } = await createSession({ passwordHash, userAgent: req.headers.get('user-agent') ?? '' });
    logger.info({ event: 'admin_login', session: session.sessionId.slice(0, 12) });
    platform.defer(pruneRateLimits());

    const cookie = sessionCookie(token, isSecureRequest(req.headers, req.url));
    const res = NextResponse.json({ data: { expiresAt: session.expiresAt } });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  },
  { route: 'POST /api/admin/login' },
);
