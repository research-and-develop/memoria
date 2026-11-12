import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore, signInError } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor, settingsKeys } from '@/lib/auth/confirm';
import { parseAuthenticatorLabel } from '@/lib/auth/parseCodeInput';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { addAuthenticator } from '@/lib/auth/securitySettings';
import { codeInvalidMessage, SIGN_IN_MESSAGES } from '@/lib/auth/signInMessages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Finish adding an authenticator app (confirm): `{ enrollmentId, label, code }`, the code from the new app. */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const confirm = requireRecentSecondFactor(admin.ctx);
    if (confirm) return confirm;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const enrollmentId = typeof body.enrollmentId === 'string' ? body.enrollmentId : '';
    if (!isUuid(enrollmentId)) return notFoundError();
    const label = parseAuthenticatorLabel(body.label);
    if (!label.ok) return noStore(invalidParamsError(label.message, label.field));
    const code = typeof body.code === 'string' ? body.code.slice(0, 32) : '';
    const keys = await settingsKeys();
    if (keys instanceof NextResponse) return keys;

    const result = await addAuthenticator({ sessionId: admin.ctx.sessionId, enrollmentId, label: label.value, code, keys, now: new Date() });
    if (result.ok) return noStore(NextResponse.json({ data: { id: result.id } }, { status: 201 }));
    switch (result.reason) {
      case 'not_found':
        return signInError(404, 'NOT_FOUND', 'This setup timed out. Start again.');
      case 'too_many_apps':
        return signInError(409, 'AUTHENTICATOR_LIMIT', 'You have 10 authenticator apps. Remove one to add another.');
      case 'key_mismatch':
        return signInError(503, 'TWO_FACTOR_NOT_CONFIGURED', SIGN_IN_MESSAGES.TWO_FACTOR_NOT_CONFIGURED);
      case 'invalid':
        return signInError(400, 'CODE_INVALID', result.attemptsLeft > 0 ? codeInvalidMessage(result.attemptsLeft) : 'That code did not work. Start again.', {
          attemptsLeft: result.attemptsLeft,
          field: 'code',
        });
    }
  },
  { route: 'POST /api/admin/authenticators' },
);
