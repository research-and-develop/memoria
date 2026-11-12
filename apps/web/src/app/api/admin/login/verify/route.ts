import { type NextRequest } from 'next/server';

import { forbiddenError, invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { logger } from '@repo/logger';

import { alreadyEnrolled, beginCodeStep, challengeExpired, codeRefused, noStore, notConfigured, signedInResponse } from '@/lib/auth/codeStep';
import { parseAuthenticatorLabel, parseCodeInput } from '@/lib/auth/parseCodeInput';
import { enrolFirstAuthenticator, signInWithCode, signInWithRecoveryCode } from '@/lib/auth/secondFactor';
import { defaultAuthenticatorLabel } from '@/lib/auth/userAgent';
import { isSameOrigin } from '@/lib/security/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sign-in step 2: a code from an authenticator app or a recovery code ('login'
 * challenge), or the first code from a new app with its name ('enroll'
 * challenge, after the setup code). Right: the session cookie; enrolling also
 * returns the 10 recovery codes, once.
 */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    if (!isSameOrigin(req)) return forbiddenError({ reason: 'cross_origin' });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseCodeInput(body);
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    const label = body.label === undefined ? null : parseAuthenticatorLabel(body.label);
    if (label && !label.ok) return noStore(invalidParamsError(label.message, label.field));

    const begun = await beginCodeStep(req, (c) => c.kind === 'login' || c.setup_code_id !== null);
    if (!begun.ok) return begun.response;
    const { step } = begun;
    const enrolling = step.challenge.kind === 'enroll';
    if (enrolling && parsed.value.kind === 'recovery') {
      return noStore(invalidParamsError('Enter the code from the app you just set up.', 'code'));
    }

    const result = enrolling
      ? await enrolFirstAuthenticator(
          step.challenge,
          { code: parsed.value.kind === 'code' ? parsed.value.code : '', label: label?.ok ? label.value : defaultAuthenticatorLabel(step.ctx.userAgent) },
          step.ctx,
        )
      : parsed.value.kind === 'code'
        ? await signInWithCode(step.challenge, parsed.value.code, step.ctx)
        : await signInWithRecoveryCode(step.challenge, parsed.value.recoveryCode, step.ctx);

    if (result.ok) {
      logger.info({ event: 'admin_login', session: result.sessionId.slice(0, 12), factor: parsed.value.kind });
      return signedInResponse(step, result);
    }
    switch (result.reason) {
      case 'expired':
        return challengeExpired(step.secure);
      case 'already_enrolled':
        return alreadyEnrolled(step.secure);
      case 'key_mismatch':
        return notConfigured();
      case 'replayed':
        return codeRefused(step, { kind: 'replayed', countsTowardLockout: false });
      case 'invalid':
        // A wrong first code from a new app is a typing or clock problem, not a guess at the account.
        return codeRefused(step, { kind: 'invalid', countsTowardLockout: !enrolling });
    }
  },
  { route: 'POST /api/admin/login/verify' },
);
