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
 * DEVELOPMENT ONLY (404 elsewhere): `/g/<slug>/data` under `next dev` — the same handler `worker.ts`
 * runs in production (plan p06 D6.5). See `../route.ts`.
 */
async function serve(req: NextRequest): Promise<Response> {
  if (!getPlatform().config().isDevelopment) return notFoundError();
  const route = galleryRoute(new URL(req.url).pathname, req.method);
  if (!route || route.kind !== 'data') return notFoundError();
  return handleGalleryRequest(req, route, await devGalleryDeps(req));
}

export const GET = withErrorHandling(serve, { route: 'GET /g/[slug]/data' });
export const HEAD = withErrorHandling(serve, { route: 'HEAD /g/[slug]/data' });
