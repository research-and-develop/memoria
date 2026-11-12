import 'server-only';

import { batch, run, type Options, type Statement } from '@repo/db/client';
import { logger } from '@repo/logger';

import {
  authenticatorExistsSql,
  hasAdminAuthenticator,
  insertFirstAuthenticatorStatement,
  listAdminAuthenticators,
  useAuthenticatorStepStatement,
} from '@/lib/db/queries/admin_authenticators';
import {
  acceptSetupCodeStatement,
  deleteChallengeAfterSessionStatement,
  getLiveChallenge,
} from '@/lib/db/queries/admin_mfa_challenges';
import {
  deleteRecoveryCodesAfterStatement,
  getRecoveryCodeStatus,
  insertRecoveryCodeAfterStatement,
  useRecoveryCodeStatement,
} from '@/lib/db/queries/admin_recovery_codes';
import { deleteExpiredAdminSessionsStatement } from '@/lib/db/queries/admin_sessions';
import { deleteSetupCodesAfterStatement, spendSetupCodeStatement } from '@/lib/db/queries/admin_setup_codes';
import { conditionalAuditStatement } from '@/lib/db/queries/audit_log';
import { hitRateLimitStatement } from '@/lib/db/queries/rate_limits';
import { hitRateLimits, isOverLimit, windowStart, type RateRule } from '@/lib/security/rateLimit';

import type { SignInChallenge } from './challenge';
import { generateRecoveryCodes, normaliseRecoveryCode } from './recoveryCodes';
import { normaliseSetupCode, setupCodeId } from './setupCode';
import { prepareSession } from './session';
import { base32Decode, generateTotpSecret, matchTotp, type TotpCandidate } from './totp';
import { authenticatorAad, pendingSecretAad, type TwoFactorKeys } from './twoFactorKeys';

/**
 * Checking second factors and writing what a right one grants, each in ONE
 * batch whose writes depend on the code's own conditional write (plan p02 →
 * Writes that must not race).
 */

/** Every second-factor attempt (sign-in, setup code, confirm): per IP and overall. */
export const codeRateRules = (ipKey: string): RateRule[] => [
  { bucket: `login:code:ip:${ipKey}`, limit: 10, windowSeconds: 15 * 60 },
  { bucket: 'login:code:global', limit: 60, windowSeconds: 60 * 60 },
];

/** The lockout (D2.11): 20 FAILED codes in a UTC day lock sign-in until midnight UTC. */
export const CODE_FAILURE_RULE: RateRule = { bucket: 'login:code:fail', limit: 20, windowSeconds: 24 * 60 * 60 };

export function isSignInLocked(opts?: Options & { now?: Date }): Promise<boolean> {
  return isOverLimit(CODE_FAILURE_RULE, opts);
}

export function hitCodeRateLimits(ipKey: string, opts?: Options & { now?: Date }) {
  return hitRateLimits(codeRateRules(ipKey), opts);
}

/**
 * Count a failure toward the lockout. The failure that reaches the limit is
 * audited, once (the audit insert checks the new count in the same batch).
 */
export async function recordCodeFailure(opts?: Options & { now?: Date }): Promise<void> {
  const now = opts?.now ?? new Date();
  const window = windowStart(now, CODE_FAILURE_RULE.windowSeconds);
  const [hit] = await batch<{ count: number }>(
    [
      hitRateLimitStatement(CODE_FAILURE_RULE.bucket, window),
      conditionalAuditStatement(
        { action: 'update', entity: 'two_factor', summary: 'Sign-in locked after too many wrong codes' },
        '(SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?) = ?',
        [CODE_FAILURE_RULE.bucket, window, CODE_FAILURE_RULE.limit],
      ),
    ],
    opts,
  );
  const count = hit?.rows[0]?.count ?? 0;
  logger.info({ event: 'admin_code_failed', failuresToday: count });
  if (count === CODE_FAILURE_RULE.limit) logger.warn({ event: 'admin_sign_in_locked' });
}

export type SignInContext = {
  keys: TwoFactorKeys;
  passwordHash: string;
  userAgent: string;
  country: string | null;
  now: Date;
};

export type SignedIn = { ok: true; token: string; sessionId: string; expiresAt: string; recoveryCodes?: string[]; recoveryCodesLeft?: number };

/**
 * Why a code did not sign in. `invalid` counts toward the lockout (except
 * when enrolling a new app), `replayed` never does (D2.20).
 */
export type NotSignedIn = { ok: false; reason: 'invalid' | 'replayed' | 'expired' | 'already_enrolled' | 'key_mismatch' };

/** After a batch with no effect: was the challenge gone (a reset, a spent challenge) or was the code itself refused? */
async function stillLive(challengeId: string, now: string, opts?: Options): Promise<boolean> {
  return (await getLiveChallenge(challengeId, now, opts)) !== null;
}

/** Decrypt every authenticator's secret; none decrypting means the key changed (D2.7). */
async function candidates(keys: TwoFactorKeys, opts?: Options): Promise<TotpCandidate[] | 'key_mismatch'> {
  const rows = await listAdminAuthenticators(opts);
  const out: TotpCandidate[] = [];
  for (const row of rows) {
    const plain = await keys.decryptSecret(row.secret_enc, authenticatorAad(row.id));
    const secret = plain ? base32Decode(plain) : null;
    if (secret) out.push({ id: row.id, secret, lastStep: row.last_step });
  }
  if (rows.length > 0 && out.length === 0) {
    logger.error({ event: 'admin_totp_key_mismatch', authenticators: rows.length });
    return 'key_mismatch';
  }
  if (out.length < rows.length) logger.warn({ event: 'admin_totp_key_mismatch', authenticators: rows.length, readable: out.length });
  return out;
}

const SESSION_CREATED = { sql: 'changes() > 0', params: [] as const };

/** A 'login' challenge and a code from an authenticator app. */
export async function signInWithCode(challenge: SignInChallenge, code: string, ctx: SignInContext, opts?: Options): Promise<SignedIn | NotSignedIn> {
  const list = await candidates(ctx.keys, opts);
  if (list === 'key_mismatch') return { ok: false, reason: 'key_mismatch' };
  const match = await matchTotp(list, code, ctx.now);
  if (match.kind === 'replay') {
    logger.info({ event: 'admin_code_replayed' });
    return { ok: false, reason: 'replayed' };
  }
  if (match.kind === 'none') return { ok: false, reason: 'invalid' };

  const now = ctx.now.toISOString();
  const session = await prepareSession({ ...ctx, secondFactor: 'authenticator', authenticatorId: match.id });
  const results = await batch(
    [
      useAuthenticatorStepStatement({ id: match.id, step: match.step, now, challengeId: challenge.id }),
      ...session.statements(SESSION_CREATED),
      deleteChallengeAfterSessionStatement(challenge.id, session.id),
      deleteExpiredAdminSessionsStatement(now),
    ],
    opts,
  );
  if ((results[1]?.changes ?? 0) === 0) {
    // Another request used this step first, or the challenge went away.
    return { ok: false, reason: (await stillLive(challenge.id, now, opts)) ? 'replayed' : 'expired' };
  }
  return { ok: true, token: session.token, sessionId: session.id, expiresAt: session.expiresAt };
}

/** A 'login' challenge and a recovery code (single use). */
export async function signInWithRecoveryCode(
  challenge: SignInChallenge,
  input: string,
  ctx: SignInContext,
  opts?: Options,
): Promise<SignedIn | NotSignedIn> {
  const normalised = normaliseRecoveryCode(input);
  if (!normalised) return { ok: false, reason: 'invalid' };
  const now = ctx.now.toISOString();
  const session = await prepareSession({ ...ctx, secondFactor: 'recovery_code', authenticatorId: null });
  const results = await batch(
    [
      useRecoveryCodeStatement({ id: await ctx.keys.recoveryCodeId(normalised), now, challengeId: challenge.id }),
      ...session.statements(SESSION_CREATED),
      deleteChallengeAfterSessionStatement(challenge.id, session.id),
      deleteExpiredAdminSessionsStatement(now),
    ],
    opts,
  );
  if ((results[1]?.changes ?? 0) === 0) {
    return { ok: false, reason: (await stillLive(challenge.id, now, opts)) ? 'invalid' : 'expired' };
  }
  const { unused } = await getRecoveryCodeStatus(opts);
  logger.info({ event: 'admin_recovery_code_used', left: unused });
  return { ok: true, token: session.token, sessionId: session.id, expiresAt: session.expiresAt, recoveryCodesLeft: unused };
}

/**
 * An 'enroll' challenge and the setup code from `npm run admin:mfa -- setup`.
 * Right: the challenge remembers the code and a new secret for the app to
 * scan. The setup code itself is spent only together with the enrolment.
 */
export async function acceptSetupCode(
  challenge: SignInChallenge,
  input: string,
  ctx: Pick<SignInContext, 'keys' | 'now'>,
  opts?: Options,
): Promise<'accepted' | 'invalid' | 'expired'> {
  const normalised = normaliseSetupCode(input);
  if (!normalised) return 'invalid';
  const now = ctx.now.toISOString();
  const pendingSecretEnc = await ctx.keys.encryptSecret(generateTotpSecret(), pendingSecretAad(challenge.id));
  const result = await run(
    acceptSetupCodeStatement({ challengeId: challenge.id, setupCodeId: await setupCodeId(normalised), pendingSecretEnc, now }),
    opts,
  );
  if (result.changes > 0) return 'accepted';
  return (await stillLive(challenge.id, now, opts)) ? 'invalid' : 'expired';
}

/** The new app's secret on an 'enroll' challenge (after its setup code), or null. */
export async function pendingSecret(challenge: SignInChallenge, keys: TwoFactorKeys): Promise<string | null> {
  if (!challenge.pending_secret_enc) return null;
  return keys.decryptSecret(challenge.pending_secret_enc, pendingSecretAad(challenge.id));
}

/**
 * First enrolment: the first code from the new app. Spends the setup code,
 * creates the authenticator (its step recorded, so this code cannot sign in
 * again), 10 recovery codes and the session, all in one batch.
 */
export async function enrolFirstAuthenticator(
  challenge: SignInChallenge,
  input: { code: string; label: string },
  ctx: SignInContext,
  opts?: Options,
): Promise<SignedIn | NotSignedIn> {
  const plain = await pendingSecret(challenge, ctx.keys);
  const secret = plain ? base32Decode(plain) : null;
  if (!plain || !secret || !challenge.setup_code_id) {
    logger.error({ event: 'admin_totp_key_mismatch', pending: true });
    return { ok: false, reason: 'key_mismatch' };
  }
  const match = await matchTotp([{ id: 'new', secret, lastStep: -1 }], input.code, ctx.now);
  if (match.kind !== 'match') return { ok: false, reason: 'invalid' };

  const now = ctx.now.toISOString();
  const authenticatorId = crypto.randomUUID();
  const secretEnc = await ctx.keys.encryptSecret(plain, authenticatorAad(authenticatorId));
  const recoveryCodes = generateRecoveryCodes();
  const recoveryIds = await Promise.all(recoveryCodes.map((code) => ctx.keys.recoveryCodeId(code)));
  const session = await prepareSession({ ...ctx, secondFactor: 'authenticator', authenticatorId });
  const anchor = { sql: authenticatorExistsSql, params: [authenticatorId] };
  const statements: Statement[] = [
    spendSetupCodeStatement({ setupCodeId: challenge.setup_code_id, challengeId: challenge.id, now }),
    insertFirstAuthenticatorStatement({ id: authenticatorId, label: input.label, secretEnc, lastStep: match.step, now }),
    deleteRecoveryCodesAfterStatement(authenticatorId),
    ...recoveryIds.map((id) => insertRecoveryCodeAfterStatement(id, authenticatorId)),
    ...session.statements(anchor),
    conditionalAuditStatement(
      { action: 'create', entity: 'authenticator', entityId: authenticatorId, summary: `Added authenticator app “${input.label}” (first sign-in)` },
      anchor.sql,
      anchor.params,
    ),
    deleteSetupCodesAfterStatement(authenticatorId),
    // Only this challenge: another device's 'enroll' challenge is answered ALREADY_ENROLLED when it comes back.
    deleteChallengeAfterSessionStatement(challenge.id, session.id),
    deleteExpiredAdminSessionsStatement(now),
  ];
  const results = await batch(statements, opts);
  if ((results[1]?.changes ?? 0) === 0) {
    return { ok: false, reason: (await hasAdminAuthenticator(opts)) ? 'already_enrolled' : 'expired' };
  }
  logger.info({ event: 'admin_enrolled', authenticator: authenticatorId });
  return { ok: true, token: session.token, sessionId: session.id, expiresAt: session.expiresAt, recoveryCodes };
}
