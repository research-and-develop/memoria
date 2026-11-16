import 'server-only';

import type { NextResponse } from 'next/server';

import { batch, type Options, type Statement } from '@repo/db/client';
import { logger } from '@repo/logger';

import { endSignInsAfterPasswordStatements, saveAdminAccountStatement } from '@/lib/db/queries/admin_account';
import { countConfirmFailureStatement, deleteSessionAtFailureCapStatement, MAX_CONFIRM_FAILURES } from '@/lib/db/queries/admin_sessions';
import { conditionalAuditStatement } from '@/lib/db/queries/audit_log';
import { securityNotices } from '@/lib/email/notices';
import { nudgeRelay } from '@/lib/jobs/enqueue';
import { hitRateLimits } from '@/lib/security/rateLimit';

import { noStore, signInError } from './codeStep';
import { requireRecentSecondFactor } from './confirm';
import { hashPassword, verifyPassword } from './password';
import type { AdminContext } from './requireAdmin';
import { clearedSessionCookie } from './session';

/**
 * Changing the sign-in email or password (plan p02b, D2b.5–6). Order: the rate
 * limits are counted first (parallel requests cannot outrun them), then the
 * code window (no window: 403, the password is never looked at, so a stolen
 * session without a code learns nothing), then the current password. Five
 * wrong passwords on one session end it, as five wrong codes do (the same
 * `code_failures` counter).
 */
export const ACCOUNT_RULES = (sessionId: string) => [
  { bucket: `account_password:${sessionId.slice(0, 32)}`, limit: 5, windowSeconds: 60 * 60 },
  { bucket: 'account_password', limit: 20, windowSeconds: 60 * 60 },
];

export const WRONG_PASSWORD_MESSAGE = 'That is not your current password.';

/** null = go on; else the finished refusal. */
export async function checkCurrentPassword(
  ctx: AdminContext,
  currentPassword: string,
  input: { secure: boolean; now: Date },
  opts?: Options,
): Promise<NextResponse | null> {
  const limit = await hitRateLimits(ACCOUNT_RULES(ctx.sessionId), { ...opts, now: input.now });
  if (limit.limited) {
    logger.warn({ event: 'admin_account_rate_limited', session: ctx.sessionId.slice(0, 12) });
    const res = signInError(429, 'RATE_LIMITED', 'Too many attempts. Try again in an hour.', { retryAfterSeconds: limit.retryAfterSeconds });
    res.headers.set('Retry-After', String(limit.retryAfterSeconds));
    return res;
  }
  const confirm = requireRecentSecondFactor(ctx, input.now);
  if (confirm) return confirm;
  if (await verifyPassword(currentPassword, ctx.account.passwordHash)) return null;

  const [counted] = await batch<{ code_failures: number }>(
    [countConfirmFailureStatement(ctx.sessionId), deleteSessionAtFailureCapStatement(ctx.sessionId)],
    opts,
  );
  const failures = counted?.rows[0]?.code_failures ?? MAX_CONFIRM_FAILURES;
  if (failures >= MAX_CONFIRM_FAILURES) {
    logger.warn({ event: 'admin_session_ended_wrong_passwords', session: ctx.sessionId.slice(0, 12) });
    const res = signInError(401, 'SESSION_ENDED', 'Too many wrong passwords. You have been signed out.');
    const cookie = clearedSessionCookie(input.secure);
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  }
  logger.info({ event: 'admin_account_wrong_password', attemptsLeft: MAX_CONFIRM_FAILURES - failures });
  return noStore(
    signInError(400, 'WRONG_PASSWORD', WRONG_PASSWORD_MESSAGE, { field: 'currentPassword', attemptsLeft: MAX_CONFIRM_FAILURES - failures }),
  );
}

export function accountChanged(): NextResponse {
  return signInError(409, 'ACCOUNT_CHANGED', 'Your sign-in was changed elsewhere. Sign in again.');
}

/**
 * Save a new email. The hash and `set_by` stay, so every session survives;
 * the first save of an env account creates the row. false = the account
 * changed since it was read (a concurrent change or a CLI reset).
 */
export async function changeAccountEmail(ctx: AdminContext, email: string, now: Date, opts?: Options): Promise<boolean> {
  const { account } = ctx;
  // Both addresses are told (D3.19), the old one first. Each notice is chained on the statement
  // before it (`changes() > 0`): the save, then the first notice. The audit after them reads the
  // last notice's changes, which is 1 exactly when the save happened.
  const notices = await securityNotices(opts);
  const chained = { sql: 'changes() > 0', params: [] };
  const told: Statement[] = [];
  for (const [address, role] of [
    [account.email, 'old'],
    [email, 'new'],
  ] as const) {
    if (role === 'new' && address === account.email) continue;
    const notice = notices('security.email-changed', { at: now.toISOString(), role }, { now, when: chained, to: { email: address } });
    if (notice) told.push(notice);
  }
  const results = await batch(
    [
      saveAdminAccountStatement({ email, passwordHash: account.passwordHash, setBy: account.setBy, expectedHash: account.passwordHash, now: now.toISOString() }),
      ...told,
      conditionalAuditStatement(
        { action: 'update', entity: 'admin_account', entityId: '1', summary: 'Changed the sign-in email', details: { fields: ['email'] } },
        'changes() > 0',
        [],
      ),
    ],
    opts,
  );
  const saved = (results[0]?.changes ?? 0) > 0;
  if (saved) logger.info({ event: 'admin_account_email_changed', session: ctx.sessionId.slice(0, 12) });
  if (saved && told.length > 0) nudgeRelay();
  return saved;
}

/**
 * Save a new password, chosen by the photographer (`set_by = 'studio'`): every
 * session and challenge ends, this one too (D2b.6). false = the account
 * changed since it was read.
 */
export async function changeAccountPassword(ctx: AdminContext, newPassword: string, now: Date, opts?: Options): Promise<boolean> {
  const { account } = ctx;
  const passwordHash = await hashPassword(newPassword);
  const notice = (await securityNotices(opts))(
    'security.password-changed',
    { at: now.toISOString() },
    { now, when: { sql: 'EXISTS (SELECT 1 FROM admin_account WHERE password_hash = ?)', params: [passwordHash] } },
  );
  const results = await batch(
    [
      saveAdminAccountStatement({ email: account.email, passwordHash, setBy: 'studio', expectedHash: account.passwordHash, now: now.toISOString() }),
      conditionalAuditStatement(
        { action: 'update', entity: 'admin_account', entityId: '1', summary: 'Changed the sign-in password', details: { fields: ['password'] } },
        'changes() > 0',
        [],
      ),
      ...endSignInsAfterPasswordStatements(passwordHash),
      ...(notice ? [notice] : []),
    ],
    opts,
  );
  const saved = (results[0]?.changes ?? 0) > 0;
  if (saved) logger.info({ event: 'admin_account_password_changed', session: ctx.sessionId.slice(0, 12) });
  if (saved && notice) nudgeRelay();
  return saved;
}
