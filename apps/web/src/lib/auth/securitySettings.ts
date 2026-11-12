import 'server-only';

import { batch, run, type Options } from '@repo/db/client';
import { logger } from '@repo/logger';

import {
  authenticatorExistsSql,
  countAdminAuthenticators,
  deleteAuthenticatorStatement,
  getAdminAuthenticatorSummary,
  insertAuthenticatorStatement,
  MAX_AUTHENTICATORS,
  renameAuthenticatorStatement,
} from '@/lib/db/queries/admin_authenticators';
import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_TTL_MS,
  countChallengeAttempt,
  createAddChallengeStatements,
  deleteChallengeAfterAuthenticatorStatement,
  deleteChallengeStatement,
  deleteOtherSessionsChallengesStatement,
  deleteSessionChallengesStatement,
  getLiveAddChallenge,
} from '@/lib/db/queries/admin_mfa_challenges';
import { deleteAllRecoveryCodesStatement, insertRecoveryCodeStatement } from '@/lib/db/queries/admin_recovery_codes';
import {
  deleteAdminSessionStatement,
  deleteAuthenticatorSessionsStatement,
  deleteOtherAdminSessionsStatement,
  deleteRecoveryCodeSessionsStatement,
} from '@/lib/db/queries/admin_sessions';
import { auditStatement, conditionalAuditStatement } from '@/lib/db/queries/audit_log';

import { generateRecoveryCodes } from './recoveryCodes';
import { passwordVersion } from './session';
import { base32Decode, generateTotpSecret, matchTotp, otpauthUri } from './totp';
import { authenticatorAad, pendingSecretAad, type TwoFactorKeys } from './twoFactorKeys';

/**
 * What Settings → Security does (plan p02 → Settings → Security), each change
 * and its audit row in one batch. The routes check the session and the
 * confirm window first (D2.9).
 */

export type Enrollment = { enrollmentId: string; secret: string; otpauthUri: string; expiresAt: string };

/** Start adding an app: a new secret on an 'add' challenge of this session (10 minutes; at most 3 live). */
export async function startEnrollment(
  input: { sessionId: string; passwordHash: string; userAgent: string; issuer: string; account: string; keys: TwoFactorKeys; now: Date },
  opts?: Options,
): Promise<Enrollment | 'too_many_apps' | 'too_many_setups'> {
  if ((await countAdminAuthenticators(opts)) >= MAX_AUTHENTICATORS) return 'too_many_apps';
  const id = crypto.randomUUID();
  const secret = generateTotpSecret();
  const expiresAt = new Date(input.now.getTime() + CHALLENGE_TTL_MS).toISOString();
  const results = await batch(
    createAddChallengeStatements({
      id,
      sessionId: input.sessionId,
      passwordVersion: await passwordVersion(input.passwordHash),
      pendingSecretEnc: await input.keys.encryptSecret(secret, pendingSecretAad(id)),
      userAgent: input.userAgent,
      now: input.now.toISOString(),
      expiresAt,
    }),
    opts,
  );
  if ((results[1]?.changes ?? 0) === 0) return 'too_many_setups';
  return { enrollmentId: id, secret, otpauthUri: otpauthUri({ issuer: input.issuer, account: input.account, secret }), expiresAt };
}

export type AddResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'too_many_apps' | 'key_mismatch' }
  | { ok: false; reason: 'invalid'; attemptsLeft: number };

/** Finish adding an app: its first code proves it reads the secret. The code's step is stored, so it cannot sign in. */
export async function addAuthenticator(
  input: { sessionId: string; enrollmentId: string; label: string; code: string; keys: TwoFactorKeys; now: Date },
  opts?: Options,
): Promise<AddResult> {
  const now = input.now.toISOString();
  const challenge = await getLiveAddChallenge(input.enrollmentId, input.sessionId, now, opts);
  if (!challenge?.pending_secret_enc) return { ok: false, reason: 'not_found' };
  const attempts = await countChallengeAttempt(challenge.id, now, opts);
  if (attempts === null) {
    await run(deleteChallengeStatement(challenge.id), opts);
    return { ok: false, reason: 'not_found' };
  }
  const plain = await input.keys.decryptSecret(challenge.pending_secret_enc, pendingSecretAad(challenge.id));
  const secret = plain ? base32Decode(plain) : null;
  if (!plain || !secret) return { ok: false, reason: 'key_mismatch' };
  const match = await matchTotp([{ id: 'new', secret, lastStep: -1 }], input.code, input.now);
  if (match.kind !== 'match') {
    const attemptsLeft = Math.max(0, CHALLENGE_MAX_ATTEMPTS - attempts);
    if (attemptsLeft === 0) await run(deleteChallengeStatement(challenge.id), opts);
    return { ok: false, reason: 'invalid', attemptsLeft };
  }

  const id = crypto.randomUUID();
  const results = await batch(
    [
      insertAuthenticatorStatement({
        id,
        label: input.label,
        secretEnc: await input.keys.encryptSecret(plain, authenticatorAad(id)),
        lastStep: match.step,
        now,
        challengeId: challenge.id,
        sessionId: input.sessionId,
      }),
      conditionalAuditStatement({ action: 'create', entity: 'authenticator', entityId: id, summary: `Added authenticator app “${input.label}”` }, authenticatorExistsSql, [
        id,
      ]),
      deleteChallengeAfterAuthenticatorStatement(challenge.id, id),
    ],
    opts,
  );
  if ((results[0]?.changes ?? 0) === 0) {
    return { ok: false, reason: (await countAdminAuthenticators(opts)) >= MAX_AUTHENTICATORS ? 'too_many_apps' : 'not_found' };
  }
  logger.info({ event: 'admin_authenticator_added', authenticator: id });
  return { ok: true, id };
}

export async function renameAuthenticator(id: string, label: string, opts?: Options): Promise<boolean> {
  const before = await getAdminAuthenticatorSummary(id, opts);
  if (!before) return false;
  const results = await batch(
    [
      renameAuthenticatorStatement(id, label),
      conditionalAuditStatement(
        { action: 'update', entity: 'authenticator', entityId: id, summary: `Renamed authenticator app “${before.label}” to “${label}”` },
        'changes() > 0',
        [],
      ),
    ],
    opts,
  );
  return (results[0]?.changes ?? 0) > 0;
}

/** Remove an app and end the sessions it signed in (but not this one). Never the last app. */
export async function removeAuthenticator(id: string, currentSessionId: string, opts?: Options): Promise<'removed' | 'not_found' | 'last'> {
  const app = await getAdminAuthenticatorSummary(id, opts);
  if (!app) return 'not_found';
  const results = await batch(
    [
      deleteAuthenticatorSessionsStatement(id, currentSessionId),
      deleteAuthenticatorStatement(id),
      conditionalAuditStatement(
        { action: 'delete', entity: 'authenticator', entityId: id, summary: `Removed authenticator app “${app.label}”` },
        'changes() > 0',
        [],
      ),
    ],
    opts,
  );
  if ((results[1]?.changes ?? 0) === 0) return (await getAdminAuthenticatorSummary(id, opts)) ? 'last' : 'not_found';
  logger.info({ event: 'admin_authenticator_removed', authenticator: id });
  return 'removed';
}

/** A new set of 10 recovery codes replaces the old one; sessions signed in with an old code end (not this one). */
export async function regenerateRecoveryCodes(currentSessionId: string, keys: TwoFactorKeys, opts?: Options): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const ids = await Promise.all(codes.map((code) => keys.recoveryCodeId(code)));
  await batch(
    [
      deleteAllRecoveryCodesStatement(),
      ...ids.map((id) => insertRecoveryCodeStatement(id)),
      deleteRecoveryCodeSessionsStatement(currentSessionId),
      auditStatement({ action: 'update', entity: 'recovery_codes', summary: 'Generated new recovery codes' }),
    ],
    opts,
  );
  return codes;
}

/** Sign out one session (its unfinished setups go with it). */
export async function signOutSession(id: string, opts?: Options): Promise<boolean> {
  const results = await batch(
    [
      deleteSessionChallengesStatement(id),
      deleteAdminSessionStatement(id),
      conditionalAuditStatement({ action: 'logout', entity: 'session', entityId: id.slice(0, 12), summary: 'Signed out a device' }, 'changes() > 0', []),
    ],
    opts,
  );
  return (results[1]?.changes ?? 0) > 0;
}

export async function signOutOtherSessions(currentSessionId: string, opts?: Options): Promise<void> {
  await batch(
    [
      deleteOtherSessionsChallengesStatement(currentSessionId),
      deleteOtherAdminSessionsStatement(currentSessionId),
      auditStatement({ action: 'logout', entity: 'session', summary: 'Signed out all other devices' }),
    ],
    opts,
  );
}
