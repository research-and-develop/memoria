import { NextResponse, type NextRequest } from 'next/server';

import { forbiddenError, invalidParamsError, jsonError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { AppError } from '@repo/core/error';
import { run } from '@repo/db/client';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { challengeCookie, challengeCookieName, challengeIdFromToken, clearedChallengeCookie, startSignInChallenge } from '@/lib/auth/challenge';
import { noStore, notConfigured, signInError, signInLocked } from '@/lib/auth/codeStep';
import { constantTimeEqualStrings } from '@/lib/auth/crypto';
import { parseLoginInput } from '@/lib/auth/parseLoginInput';
import { verifyPassword } from '@/lib/auth/password';
import { isSignInLocked } from '@/lib/auth/secondFactor';
import { SIGN_IN_MESSAGES } from '@/lib/auth/signInMessages';
import { hasAdminAuthenticator } from '@/lib/db/queries/admin_authenticators';
import { deleteChallengeStatement } from '@/lib/db/queries/admin_mfa_challenges';
import { hasLiveSetupCode } from '@/lib/db/queries/admin_setup_codes';
import { hitRateLimits, ipKey, pruneRateLimits } from '@/lib/security/rateLimit';
import { clientIp, isSameOrigin, isSecureRequest, readCookie } from '@/lib/security/request';
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
 * Sign-in step 1: the password. Order matters: same-origin → parse → count
 * the attempt (rate limit) → the code lockout (before the password, so it
 * reveals nothing) → Turnstile → credentials (email and password always both
 * checked, so timing does not reveal which was wrong) → a challenge for step 2.
 * No session exists yet: `next` says which step the page shows.
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
    const now = new Date();
    const limit = await hitRateLimits(RULES(await ipKey(ip, config.hashSalt, now)), { now });
    if (limit.limited) {
      logger.warn({ event: 'admin_login_rate_limited' });
      return noStore(tooManyRequestsError(limit.retryAfterSeconds, 'Too many attempts. Try again in a few minutes.'));
    }
    if (await isSignInLocked({ now })) return signInLocked();

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
      return noStore(jsonError(401, { error: 'Unauthorized', errorCode: 'INVALID_CREDENTIALS', details: { message: WRONG } }));
    }

    if (!config.admin.totpKey) return notConfigured();
    const enrolled = await hasAdminAuthenticator();
    if (!enrolled && !(await hasLiveSetupCode(now.toISOString()))) {
      return signInError(503, 'TWO_FACTOR_SETUP_REQUIRED', SIGN_IN_MESSAGES.TWO_FACTOR_SETUP_REQUIRED);
    }

    const kind = enrolled ? 'login' : 'enroll';
    const { token, id } = await startSignInChallenge({ kind, passwordHash, userAgent: req.headers.get('user-agent') ?? '', now });
    logger.info({ event: 'admin_password_ok', challenge: id.slice(0, 12), next: kind });
    platform.defer(pruneRateLimits());

    const cookie = challengeCookie(token, isSecureRequest(req.headers, req.url));
    const res = noStore(NextResponse.json({ data: { next: enrolled ? 'code' : 'setup' } }));
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  },
  { route: 'POST /api/admin/login' },
);

/** "Start over": forget the half-finished sign-in. Works with or without a live challenge. */
export const DELETE = withErrorHandling(
  async (req: NextRequest) => {
    if (!isSameOrigin(req)) return forbiddenError({ reason: 'cross_origin' });
    const secure = isSecureRequest(req.headers, req.url);
    const id = await challengeIdFromToken(readCookie(req.headers, challengeCookieName(secure)));
    if (id) await run(deleteChallengeStatement(id));
    const cookie = clearedChallengeCookie(secure);
    const res = noStore(NextResponse.json({ data: { ok: true } }));
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  },
  { route: 'DELETE /api/admin/login' },
);
