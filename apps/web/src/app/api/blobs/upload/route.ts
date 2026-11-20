import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { getPlatform } from '@repo/platform/current';

import { withBlobSecurityHeaders } from '@/lib/media/blobResponseHeaders';
import { checkUpload } from '@/lib/media/devBlobRequest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DEVELOPMENT ONLY (404 elsewhere): stores an upload made through a URL from
 * `blobUrls(config).uploadUrl` in dev mode. Production uploads go straight to R2
 * through a presigned S3 URL and never reach the Worker. The body is buffered
 * (≤ MAX_DEV_UPLOAD_BYTES). Checks and their order: src/lib/media/devBlobRequest.ts.
 */
export const PUT = withErrorHandling(
  async (req: NextRequest) => {
    const platform = getPlatform();
    const checked = await checkUpload(req, platform.config(), Math.floor(Date.now() / 1000));
    if (!checked.ok) return withBlobSecurityHeaders(checked.response);
    const { bucket, key, contentType, size } = checked.value;

    const bytes = await req.arrayBuffer();
    if (bytes.byteLength !== size) {
      return withBlobSecurityHeaders(invalidParamsError('The body must be the size the upload link was made for', 'body'));
    }
    // Overwrites, like the presigned S3 PUT it stands in for: a resumed upload (D5.9) PUTs the
    // same keys again. The token is minted for this key only.
    const stored = await platform.blobs(bucket).put(key, bytes, { contentType });
    if (!stored) throw new Error('blob put refused without ifAbsent');
    return withBlobSecurityHeaders(NextResponse.json({ data: { key, size: stored.size, etag: stored.etag } }));
  },
  { route: 'PUT /api/blobs/upload' },
);
