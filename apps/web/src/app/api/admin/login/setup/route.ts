import { NextResponse, type NextRequest } from 'next/server';

import { forbiddenError, invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';

import { beginCodeStep, challengeExpired, codeRefused, noStore } from '@/lib/auth/codeStep';
import { parseSetupCodeInput } from '@/lib/auth/parseCodeInput';
import { acceptSetupCode } from '@/lib/auth/secondFactor';
import { isSameOrigin } from '@/lib/security/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * First sign-in, step 2: the setup code printed by `npm run admin:mfa -- setup`
 * (D2.2). Right: the page shows a QR code for the new app. The setup code is
 * spent only when the app's first code is accepted (login/verify).
 */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    if (!isSameOrigin(req)) return forbiddenError({ reason: 'cross_origin' });
    const parsed = parseSetupCodeInput(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));

    const begun = await beginCodeStep(req, (c) => c.kind === 'enroll' && c.setup_code_id === null);
    if (!begun.ok) return begun.response;
    const { step } = begun;

    const result = await acceptSetupCode(step.challenge, parsed.value, step.ctx);
    if (result === 'expired') return challengeExpired(step.secure);
    if (result === 'invalid') return codeRefused(step, { kind: 'invalid', what: 'setup code', countsTowardLockout: true });
    return noStore(NextResponse.json({ data: { next: 'enroll' } }));
  },
  { route: 'POST /api/admin/login/setup' },
);
