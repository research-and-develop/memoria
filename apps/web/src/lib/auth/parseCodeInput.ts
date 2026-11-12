/**
 * The second-factor forms' input (pure; shared by the forms and the routes).
 * Exactly one kind of code: an authenticator `code` or a `recoveryCode`. The
 * code's shape is not checked here: a malformed code is a wrong code (it
 * counts an attempt, so the form cannot probe for free).
 */
import { AUTHENTICATOR_LABEL_MAX } from '@/lib/db/queries/admin_authenticators/types';

import { SIGN_IN_MESSAGES } from './signInMessages';

export type CodeInput = { kind: 'code'; code: string } | { kind: 'recovery'; recoveryCode: string };

type Fail = { ok: false; field: string; message: string };

const asRecord = (raw: unknown): Record<string, unknown> => (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {});
const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

export function parseCodeInput(raw: unknown): { ok: true; value: CodeInput } | Fail {
  const body = asRecord(raw);
  const code = text(body.code, 32);
  const recoveryCode = text(body.recoveryCode, 64);
  if (code && !recoveryCode) return { ok: true, value: { kind: 'code', code } };
  if (recoveryCode && !code) return { ok: true, value: { kind: 'recovery', recoveryCode } };
  return { ok: false, field: 'code', message: SIGN_IN_MESSAGES.BOTH_OR_NEITHER };
}

/** A name for an authenticator app: trimmed, 1–60 characters, no control characters. */
export function parseAuthenticatorLabel(raw: unknown): { ok: true; value: string } | Fail {
  const label = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!label || [...label].some((ch) => ch < ' ' || ch === '\u007f')) return { ok: false, field: 'label', message: 'Enter a name for this app.' };
  if ([...label].length > AUTHENTICATOR_LABEL_MAX) {
    return { ok: false, field: 'label', message: `Use at most ${AUTHENTICATOR_LABEL_MAX} characters.` };
  }
  return { ok: true, value: label };
}

export function parseSetupCodeInput(raw: unknown): { ok: true; value: string } | Fail {
  const setupCode = text(asRecord(raw).setupCode, 64);
  return setupCode ? { ok: true, value: setupCode } : { ok: false, field: 'setupCode', message: 'Enter the setup code.' };
}
