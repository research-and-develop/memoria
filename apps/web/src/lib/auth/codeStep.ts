import 'server-only';

import { NextResponse } from 'next/server';

import { jsonError } from '@repo/api/responses';
import { run, type Options } from '@repo/db/client';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { CHALLENGE_MAX_ATTEMPTS, countChallengeAttempt, deleteChallengeStatement } from '@/lib/db/queries/admin_mfa_challenges';
import { ipKey } from '@/lib/security/rateLimit';
import { clientCountry, clientIp, isSecureRequest, readCookie } from '@/lib/security/request';

import { challengeCookieName, clearedChallengeCookie, loadSignInChallenge, type SignInChallenge } from './challenge';
import { hitCodeRateLimits, isSignInLocked, recordCodeFailure, type SignedIn, type SignInContext } from './secondFactor';
import { sessionCookie, type CookieSpec } from './session';
import { codeInvalidMessage, codeRateLimitedMessage, SIGN_IN_MESSAGES } from './signInMessages';
import { twoFactorKeys } from './twoFactorKeys';

/**
 * What every second-factor sign-in route does first (plan p02 → Sign-in flow):
 * the challenge cookie → a live challenge of the right kind → the key → the
 * lockout → the code rate limits → count the attempt. Each refusal is a
 * finished response; every response is `no-store`.
 */
export type CodeStep = {
  challenge: SignInChallenge;
  ctx: SignInContext;
  secure: boolean;
  /** Attempts used on this challenge, this one included. */
  attempts: number;
};

export function noStore<T extends Response>(res: T): T {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function withCookie(res: NextResponse, cookie: CookieSpec): NextResponse {
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}

export function signInError(status: number, errorCode: keyof typeof SIGN_IN_MESSAGES | string, message: string, extra: Record<string, unknown> = {}) {
  return noStore(jsonError(status, { error: message, errorCode, details: { message, ...extra } }));
}

/** The challenge is gone or useless: back to the password, cookie cleared. */
export function challengeExpired(secure: boolean): NextResponse {
  return withCookie(signInError(401, 'CHALLENGE_EXPIRED', SIGN_IN_MESSAGES.CHALLENGE_EXPIRED), clearedChallengeCookie(secure));
}

export function alreadyEnrolled(secure: boolean): NextResponse {
  return withCookie(signInError(409, 'ALREADY_ENROLLED', SIGN_IN_MESSAGES.ALREADY_ENROLLED), clearedChallengeCookie(secure));
}

export function notConfigured(): NextResponse {
  return signInError(503, 'TWO_FACTOR_NOT_CONFIGURED', SIGN_IN_MESSAGES.TWO_FACTOR_NOT_CONFIGURED);
}

export function signInLocked(): NextResponse {
  logger.warn({ event: 'admin_sign_in_locked' });
  return signInError(429, 'SIGN_IN_LOCKED', SIGN_IN_MESSAGES.SIGN_IN_LOCKED);
}

export async function beginCodeStep(
  req: Request,
  accepts: (challenge: SignInChallenge) => boolean,
  opts?: Options,
): Promise<{ ok: false; response: NextResponse } | { ok: true; step: CodeStep }> {
  const secure = isSecureRequest(req.headers, req.url);
  const config = getPlatform().config();
  const now = new Date();
  const loaded = await loadSignInChallenge(readCookie(req.headers, challengeCookieName(secure)), { passwordHash: config.admin.passwordHash, now }, opts);
  if (loaded.status === 'already_enrolled') return { ok: false, response: alreadyEnrolled(secure) };
  if (loaded.status === 'none') return { ok: false, response: challengeExpired(secure) };
  const { challenge } = loaded;
  if (!accepts(challenge)) {
    await run(deleteChallengeStatement(challenge.id), opts);
    return { ok: false, response: challengeExpired(secure) };
  }
  if (!config.admin.totpKey) return { ok: false, response: notConfigured() };
  if (await isSignInLocked({ ...opts, now })) return { ok: false, response: signInLocked() };

  const limit = await hitCodeRateLimits(await ipKey(clientIp(req), config.hashSalt, now), { ...opts, now });
  if (limit.limited) {
    logger.warn({ event: 'admin_code_rate_limited' });
    const res = signInError(429, 'RATE_LIMITED', codeRateLimitedMessage(limit.retryAfterSeconds), { retryAfterSeconds: limit.retryAfterSeconds });
    res.headers.set('Retry-After', String(limit.retryAfterSeconds));
    return { ok: false, response: res };
  }

  const attempts = await countChallengeAttempt(challenge.id, now.toISOString(), opts);
  if (attempts === null) {
    logger.info({ event: 'admin_challenge_spent' });
    await run(deleteChallengeStatement(challenge.id), opts);
    return { ok: false, response: challengeExpired(secure) };
  }

  const ctx: SignInContext = {
    keys: await twoFactorKeys(config.admin.totpKey),
    passwordHash: config.admin.passwordHash,
    userAgent: req.headers.get('user-agent') ?? '',
    country: clientCountry(req.headers),
    now,
  };
  return { ok: true, step: { challenge, ctx, secure, attempts } };
}

/**
 * A refused code. `countsTowardLockout`: a wrong sign-in, recovery or setup
 * code (D2.11); never a replay (D2.20) or a wrong first code from a new app.
 * The fifth attempt spends the challenge: back to the password.
 */
export async function codeRefused(
  step: CodeStep,
  input: { kind: 'invalid' | 'replayed'; what?: 'code' | 'setup code'; countsTowardLockout: boolean },
  opts?: Options,
): Promise<NextResponse> {
  if (input.countsTowardLockout && input.kind === 'invalid') await recordCodeFailure({ ...opts, now: step.ctx.now });
  const attemptsLeft = Math.max(0, CHALLENGE_MAX_ATTEMPTS - step.attempts);
  const message =
    input.kind === 'replayed'
      ? SIGN_IN_MESSAGES.CODE_ALREADY_USED + (attemptsLeft === 0 ? ' Enter your password again.' : '')
      : codeInvalidMessage(attemptsLeft, input.what);
  const res = signInError(401, input.kind === 'replayed' ? 'CODE_ALREADY_USED' : 'CODE_INVALID', message, { attemptsLeft });
  if (attemptsLeft > 0) return res;
  await run(deleteChallengeStatement(step.challenge.id), opts);
  return withCookie(res, clearedChallengeCookie(step.secure));
}

/** Signed in: the session cookie set, the challenge cookie cleared. */
export function signedInResponse(step: CodeStep, result: SignedIn): NextResponse {
  const data: Record<string, unknown> = { expiresAt: result.expiresAt };
  if (result.recoveryCodes) data.recoveryCodes = result.recoveryCodes;
  if (result.recoveryCodesLeft !== undefined) data.recoveryCodesLeft = result.recoveryCodesLeft;
  const res = noStore(NextResponse.json({ data }));
  withCookie(res, sessionCookie(result.token, step.secure));
  return withCookie(res, clearedChallengeCookie(step.secure));
}
