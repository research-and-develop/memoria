/**
 * Facts about an incoming request, read the same way everywhere. Pure (takes
 * the Request).
 */

/** The visitor's IP: Cloudflare's `CF-Connecting-IP`, else the first `X-Forwarded-For` hop (local dev). */
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
}

/** Is the request served over HTTPS (the session cookie gets `Secure` + `__Host-`)? */
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0]?.trim() === 'https';
  return new URL(req.url).protocol === 'https:';
}

/**
 * CSRF check for a state-changing request: the browser says it came from this
 * site. `Sec-Fetch-Site: same-origin` when present, otherwise `Origin` must be
 * this request's own origin. A request with neither (an old browser or a
 * script) is refused.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
