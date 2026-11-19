import type { NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { getPlatform } from '@repo/platform/current';

import { handleGalleryRequest } from '@/lib/edge/gallery/handler';
import { galleryRoute } from '@/lib/edge/routes';
import { devGalleryDeps } from '@/lib/galleries/devGalleryDeps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DEVELOPMENT ONLY (404 elsewhere): `/g/<slug>` under `next dev`, which never runs `worker.ts`. The
 * same handler `worker.ts` runs in production (plan p06 D6.5). In production `worker.ts` answers every
 * `/g/*` path before Next, so a request reaching this route there is unexpected: it must not serve.
 */
async function serve(req: NextRequest): Promise<Response> {
  if (!getPlatform().config().isDevelopment) return notFoundError();
  const route = galleryRoute(new URL(req.url).pathname, req.method);
  if (!route || route.kind !== 'page') return notFoundError();
  return handleGalleryRequest(req, route, await devGalleryDeps(req));
}

export const GET = withErrorHandling(serve, { route: 'GET /g/[slug]' });
export const HEAD = withErrorHandling(serve, { route: 'HEAD /g/[slug]' });
