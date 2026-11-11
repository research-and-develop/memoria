/**
 * Paths the Worker entry answers before Next.js loads (apps/web/worker.ts).
 * Pure and dependency-free: takes the request and the env, returns a Response,
 * or null for "not mine — hand it to Next".
 */
export const HEALTH_PATH = '/healthz';

/** Same value as the Next responses get (src/lib/security/headers.mjs): nothing is indexed. */
export const ROBOTS_TAG = 'noindex, nofollow';

type EdgeEnv = { CF_VERSION_METADATA?: { id: string } };

export function edgeResponse(request: Request, env: EdgeEnv): Response | null {
  const { pathname } = new URL(request.url);
  if (pathname === HEALTH_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
    // Liveness only: no D1 read, so an uptime check costs none of the daily allowance.
    const body = request.method === 'HEAD' ? null : JSON.stringify({ data: { status: 'ok', version: env.CF_VERSION_METADATA?.id ?? null } });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': ROBOTS_TAG },
    });
  }
  return null;
}
