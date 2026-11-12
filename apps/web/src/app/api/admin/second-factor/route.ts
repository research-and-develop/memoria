import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { noStore, signInError, signInLocked } from '@/lib/auth/codeStep';
import { confirmedResponse, confirmWithCode, settingsKeys } from '@/lib/auth/confirm';
import { parseCodeInput } from '@/lib/auth/parseCodeInput';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { hitCodeRateLimits, isSignInLocked } from '@/lib/auth/secondFactor';
import { clearedSessionCookie } from '@/lib/auth/session';
import { codeInvalidMessage, codeRateLimitedMessage, SIGN_IN_MESSAGES } from '@/lib/auth/signInMessages';
import { MAX_CONFIRM_FAILURES } from '@/lib/db/queries/admin_sessions';
import { ipKey } from '@/lib/security/rateLimit';
import { clientIp, isSecureRequest } from '@/lib/security/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Confirm with a code (D2.9): a code from an authenticator app or a recovery
 * code opens a 5-minute window for this session's sensitive settings. Wrong
 * codes count toward the sign-in lockout, and five on one session end it.
 */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const parsed = parseCodeInput(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    const keys = await settingsKeys();
    if (keys instanceof NextResponse) return keys;

    const now = new Date();
    if (await isSignInLocked({ now })) return signInLocked();
    const limit = await hitCodeRateLimits(await ipKey(clientIp(req), getPlatform().config().hashSalt, now), { now });
    if (limit.limited) {
      const res = signInError(429, 'RATE_LIMITED', codeRateLimitedMessage(limit.retryAfterSeconds), { retryAfterSeconds: limit.retryAfterSeconds });
      res.headers.set('Retry-After', String(limit.retryAfterSeconds));
      return res;
    }

    const result = await confirmWithCode(admin.ctx, parsed.value, keys, now);
    if (result.ok) return confirmedResponse(result);
    if (result.reason !== 'invalid') {
      return result.reason === 'key_mismatch'
        ? signInError(503, 'TWO_FACTOR_NOT_CONFIGURED', SIGN_IN_MESSAGES.TWO_FACTOR_NOT_CONFIGURED)
        : signInError(401, 'CODE_ALREADY_USED', SIGN_IN_MESSAGES.CODE_ALREADY_USED);
    }
    if (result.ended) {
      const res = signInError(401, 'SESSION_ENDED', 'Too many wrong codes. You have been signed out.');
      const cookie = clearedSessionCookie(isSecureRequest(req.headers, req.url));
      res.cookies.set(cookie.name, cookie.value, cookie.options);
      return res;
    }
    const attemptsLeft = MAX_CONFIRM_FAILURES - result.failures;
    logger.info({ event: 'admin_confirm_code_failed', attemptsLeft });
    return signInError(401, 'CODE_INVALID', codeInvalidMessage(attemptsLeft), { attemptsLeft });
  },
  { route: 'POST /api/admin/second-factor' },
);
