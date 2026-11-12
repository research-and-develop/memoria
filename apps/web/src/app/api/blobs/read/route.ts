import type { NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { getPlatform } from '@repo/platform/current';

import { blobReadHeaders, withBlobSecurityHeaders } from '@/lib/media/blobResponseHeaders';
import { checkRead } from '@/lib/media/devBlobRequest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DEVELOPMENT ONLY (404 elsewhere): serves a stored file through a URL from
 * `blobUrls(config).readUrl` in dev mode. Production downloads use presigned S3
 * URLs; gallery images use the public media domain or the Worker's protected
 * path (Phase 6), never this. Checks: src/lib/media/devBlobRequest.ts.
 */
export const GET = withErrorHandling(
  async (req: NextRequest) => {
    const platform = getPlatform();
    const now = Math.floor(Date.now() / 1000);
    const checked = await checkRead(req, platform.config(), now);
    if (!checked.ok) return withBlobSecurityHeaders(checked.response);
    const { key } = checked.value;

    const blobs = platform.blobs();
    const meta = await blobs.head(key);
    if (!meta) return withBlobSecurityHeaders(notFoundError());
    const headers = blobReadHeaders(meta, checked.value, now);
    if (req.headers.get('if-none-match') === meta.etag) {
      headers.delete('Content-Length');
      return new Response(null, { status: 304, headers });
    }
    const object = await blobs.get(key);
    if (!object) return withBlobSecurityHeaders(notFoundError());
    return new Response(object.body, { status: 200, headers: blobReadHeaders(object, checked.value, now) });
  },
  { route: 'GET /api/blobs/read' },
);
