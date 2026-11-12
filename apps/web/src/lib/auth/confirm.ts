import 'server-only';

import { NextResponse } from 'next/server';

import { batch, type Options } from '@repo/db/client';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { useAuthenticatorStepStatement } from '@/lib/db/queries/admin_authenticators';
import { getRecoveryCodeStatus, useRecoveryCodeStatement } from '@/lib/db/queries/admin_recovery_codes';
import {
  countConfirmFailureStatement,
  deleteSessionAtFailureCapStatement,
  MAX_CONFIRM_FAILURES,
  openConfirmWindowStatement,
} from '@/lib/db/queries/admin_sessions';

import { noStore, signInError } from './codeStep';
import type { CodeInput } from './parseCodeInput';
import { normaliseRecoveryCode } from './recoveryCodes';
import type { AdminContext } from './requireAdmin';
import { authenticatorCandidates, recordCodeFailure } from './secondFactor';
import { matchTotp } from './totp';
import { twoFactorKeys, type TwoFactorKeys } from './twoFactorKeys';

/**
 * "Confirm with a code" (D2.9). Adding, renaming or removing an authenticator,
 * new recovery codes and signing out OTHER devices need a code entered on this
 * session in the last 5 minutes: a stolen cookie alone cannot plant an app or
 * lock the owner out. Five wrong codes end the session. NULL after sign-in:
 * the sign-in code does not count.
 */
export const CONFIRM_WINDOW_MS = 5 * 60 * 1000;

export const SECOND_FACTOR_REQUIRED_MESSAGE = 'Enter a code to continue. You will not be asked again for 5 minutes.';

/** null when the window is open; else the 403 the client turns into the code dialog. */
export function requireRecentSecondFactor(ctx: AdminContext, now = new Date()): NextResponse | null {
  const until = ctx.session.verifiedUntil;
  if (until && Date.parse(until) > now.getTime()) return null;
  return signInError(403, 'SECOND_FACTOR_REQUIRED', SECOND_FACTOR_REQUIRED_MESSAGE);
}

/** The key, or the 503 every two-factor route answers without it. */
export async function settingsKeys(): Promise<TwoFactorKeys | NextResponse> {
  const key = getPlatform().config().admin.totpKey;
  if (!key) return signInError(503, 'TWO_FACTOR_NOT_CONFIGURED', 'Two-factor sign-in is not configured on the server.');
  return twoFactorKeys(key);
}

export type Confirmed = { ok: true; verifiedUntil: string; recoveryCodesLeft?: number };
export type NotConfirmed =
  | { ok: false; reason: 'replayed' | 'key_mismatch' }
  /** `failures` on this session so far; `ended`: that was the fifth, the session is gone. */
  | { ok: false; reason: 'invalid'; failures: number; ended: boolean };

/** Check a code or a recovery code for the current session and open the window. */
export async function confirmWithCode(
  ctx: AdminContext,
  input: CodeInput,
  keys: TwoFactorKeys,
  now: Date,
  opts?: Options,
): Promise<Confirmed | NotConfirmed> {
  const iso = now.toISOString();
  const until = new Date(now.getTime() + CONFIRM_WINDOW_MS).toISOString();
  const open = openConfirmWindowStatement(ctx.sessionId, until);

  if (input.kind === 'code') {
    const list = await authenticatorCandidates(keys, opts);
    if (list === 'key_mismatch') return { ok: false, reason: 'key_mismatch' };
    const match = await matchTotp(list, input.code, now);
    if (match.kind === 'replay') return { ok: false, reason: 'replayed' };
    if (match.kind === 'match') {
      const results = await batch([useAuthenticatorStepStatement({ id: match.id, step: match.step, now: iso, challengeId: null }), open], opts);
      if ((results[1]?.changes ?? 0) > 0) return { ok: true, verifiedUntil: until };
      return { ok: false, reason: 'replayed' };
    }
  } else {
    const normalised = normaliseRecoveryCode(input.recoveryCode);
    if (normalised) {
      const id = await keys.recoveryCodeId(normalised);
      const results = await batch([useRecoveryCodeStatement({ id, now: iso, challengeId: null }), open], opts);
      if ((results[1]?.changes ?? 0) > 0) {
        logger.info({ event: 'admin_recovery_code_used', purpose: 'confirm' });
        return { ok: true, verifiedUntil: until, recoveryCodesLeft: (await getRecoveryCodeStatus(opts)).unused };
      }
    }
  }

  await recordCodeFailure({ ...opts, now });
  const [counted] = await batch<{ code_failures: number }>(
    [countConfirmFailureStatement(ctx.sessionId), deleteSessionAtFailureCapStatement(ctx.sessionId)],
    opts,
  );
  const failures = counted?.rows[0]?.code_failures ?? MAX_CONFIRM_FAILURES;
  const ended = failures >= MAX_CONFIRM_FAILURES;
  if (ended) logger.warn({ event: 'admin_session_ended_wrong_codes', session: ctx.sessionId.slice(0, 12) });
  return { ok: false, reason: 'invalid', failures, ended };
}

/** The window is open: say until when. */
export function confirmedResponse(result: Confirmed): NextResponse {
  return noStore(NextResponse.json({ data: { verifiedUntil: result.verifiedUntil, recoveryCodesLeft: result.recoveryCodesLeft } }));
}
