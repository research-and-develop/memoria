import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore, signInError } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor } from '@/lib/auth/confirm';
import { parseAuthenticatorLabel } from '@/lib/auth/parseCodeInput';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { removeAuthenticator, renameAuthenticator } from '@/lib/auth/securitySettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Rename an authenticator app (confirm): `{ label }`. */
export const PATCH = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const confirm = requireRecentSecondFactor(admin.ctx);
    if (confirm) return confirm;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const label = parseAuthenticatorLabel(((await req.json().catch(() => ({}))) as Record<string, unknown>).label);
    if (!label.ok) return noStore(invalidParamsError(label.message, label.field));
    if (!(await renameAuthenticator(id, label.value))) return notFoundError();
    return noStore(NextResponse.json({ data: { id, label: label.value } }));
  },
  { route: 'PATCH /api/admin/authenticators/[id]' },
);

/** Remove an authenticator app (confirm). Never the last one; the devices it signed in are signed out. */
export const DELETE = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const confirm = requireRecentSecondFactor(admin.ctx);
    if (confirm) return confirm;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const result = await removeAuthenticator(id, admin.ctx.sessionId);
    if (result === 'not_found') return notFoundError();
    if (result === 'last') return signInError(409, 'LAST_AUTHENTICATOR', 'You need at least one authenticator app.');
    return noStore(NextResponse.json({ data: { id } }));
  },
  { route: 'DELETE /api/admin/authenticators/[id]' },
);
