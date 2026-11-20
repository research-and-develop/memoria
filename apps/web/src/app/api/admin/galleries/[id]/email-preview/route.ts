import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getGallery } from '@/lib/db/queries/galleries';
import { parseClientName } from '@/lib/galleries/parseShareInput';
import { previewGalleryEmail } from '@/lib/galleries/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * The client email exactly as it would be sent now (D5.20): the template's `load`, then its render →
 * `{ subject, html, text }`. The panel shows the HTML in a sandboxed `iframe srcdoc`. Same 409s as
 * the send.
 */
export const GET = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const query = req.nextUrl.searchParams;
    const name = parseClientName(query.get('name'));
    if (!name.ok) return noStore(invalidParamsError(name.message, name.field));
    const gallery = await getGallery(id);
    if (!gallery || gallery.deleted_at) return notFoundError();
    const email = await previewGalleryEmail({ gallery, name: name.value, includePassword: query.get('include_password') === '1' });
    return noStore(NextResponse.json({ data: email }));
  },
  { route: 'GET /api/admin/galleries/[id]/email-preview' },
);
