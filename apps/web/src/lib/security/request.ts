/**
 * Facts about an incoming request, read the same way everywhere. Pure (takes
 * the Request or its headers).
 */

/** The visitor's IP: Cloudflare's `CF-Connecting-IP`, else the first `X-Forwarded-For` hop (local dev). */
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
}

/**
 * The visitor's country from Cloudflare's `CF-IPCountry` (two letters), or null:
 * missing, unknown (`XX`) or Tor (`T1`).
 */
export function clientCountry(headers: Headers): string | null {
  const value = headers.get('cf-ipcountry')?.trim() ?? '';
  return /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1' ? value : null;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * Is the request served over HTTPS (cookies get `Secure` and the `__Host-` prefix)?
 * `X-Forwarded-Proto` when present, else the URL's scheme when known, else
 * HTTPS unless the host is local (`localhost`, loopback, a private IPv4).
 * One rule for routes (`isSecureRequest(req.headers, req.url)`) and server
 * pages (`isSecureRequest(await headers())`), so both read the same cookie.
 */
export function isSecureRequest(headers: Headers, url?: string | URL): boolean {
  const proto = headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0]?.trim() === 'https';
  if (url) return new URL(url).protocol === 'https:';
  const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').trim().toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0] ?? '';
  return !LOCAL_HOST.test(name);
}

/** One cookie's value from the `Cookie` header, or null. */
export function readCookie(headers: Headers, name: string): string | null {
  const header = headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.join('='));
    } catch {
      return null;
    }
  }
  return null;
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
