import 'server-only';

import { batch, run, type Options } from '@repo/db/client';

import { hasAdminAuthenticator } from '@/lib/db/queries/admin_authenticators';
import {
  CHALLENGE_TTL_MS,
  createSignInChallengeStatement,
  deleteChallengeStatement,
  deleteExpiredChallengesStatement,
  getLiveChallenge,
  type AdminMfaChallengeRow,
} from '@/lib/db/queries/admin_mfa_challenges';

import { randomToken, sha256Hex } from './crypto';
import { passwordVersion, type CookieSpec } from './session';

/**
 * The step between the password and the code (D2.4): a D1 row found by the
 * SHA-256 of a random token in its own httpOnly cookie. Ten minutes, five
 * attempts, single use. No session token exists until the code is right.
 */
export function challengeCookieName(secure: boolean): string {
  return secure ? '__Host-memoria_admin_mfa' : 'memoria_admin_mfa';
}

export function challengeCookie(token: string, secure: boolean, maxAgeSeconds = CHALLENGE_TTL_MS / 1000): CookieSpec {
  return { name: challengeCookieName(secure), value: token, options: { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds } };
}

export function clearedChallengeCookie(secure: boolean): CookieSpec {
  return challengeCookie('', secure, 0);
}

/** The row id behind a cookie token, or null for anything that is not a token. */
export async function challengeIdFromToken(token: string | null | undefined): Promise<string | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return sha256Hex(token);
}

/** Step 1 passed: a new 'login' or 'enroll' challenge (expired ones are swept first). */
export async function startSignInChallenge(
  input: { kind: 'login' | 'enroll'; passwordHash: string; userAgent: string; now: Date },
  opts?: Options,
): Promise<{ token: string; id: string }> {
  const token = randomToken();
  const id = await sha256Hex(token);
  await batch(
    [
      deleteExpiredChallengesStatement(input.now.toISOString()),
      createSignInChallengeStatement({
        id,
        kind: input.kind,
        passwordVersion: await passwordVersion(input.passwordHash),
        userAgent: input.userAgent,
        expiresAt: new Date(input.now.getTime() + CHALLENGE_TTL_MS).toISOString(),
      }),
    ],
    opts,
  );
  return { token, id };
}

export type SignInChallenge = AdminMfaChallengeRow & { kind: 'login' | 'enroll' };

export type LoadedChallenge =
  | { status: 'live'; challenge: SignInChallenge }
  /** No cookie, no row, expired, made under another password, or 'login' with no authenticator left (a reset). */
  | { status: 'none'; hadCookie: boolean }
  /** An 'enroll' challenge, but an authenticator exists now (set up from another device). */
  | { status: 'already_enrolled' };

/**
 * The sign-in challenge behind a cookie token, checked against the current
 * state. A challenge that can no longer succeed is deleted on sight.
 */
export async function loadSignInChallenge(
  token: string | null | undefined,
  input: { passwordHash: string; now: Date },
  opts?: Options,
): Promise<LoadedChallenge> {
  const id = await challengeIdFromToken(token);
  if (!id) return { status: 'none', hadCookie: Boolean(token) };
  const row = await getLiveChallenge(id, input.now.toISOString(), opts);
  if (!row || row.kind === 'add') return { status: 'none', hadCookie: true };
  const stale = !input.passwordHash || row.password_version !== (await passwordVersion(input.passwordHash));
  const enrolled = stale ? false : await hasAdminAuthenticator(opts);
  if (stale || (row.kind === 'login' && !enrolled)) {
    await run(deleteChallengeStatement(id), opts);
    return { status: 'none', hadCookie: true };
  }
  if (row.kind === 'enroll' && enrolled) {
    await run(deleteChallengeStatement(id), opts);
    return { status: 'already_enrolled' };
  }
  return { status: 'live', challenge: row as SignInChallenge };
}
