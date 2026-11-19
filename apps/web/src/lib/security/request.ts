/**
 * Facts about an incoming request, read the same way everywhere. Pure (takes
 * the Request or its headers).
 */

/** The visitor's IP: Cloudflare's `CF-Connecting-IP`, else the first `X-Forwarded-For` hop (local dev). */
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
}

/**
 * The part of an IP address that names ONE client, for rate-limit keys (plan p06 D6.10): an IPv4
 * address as is (/32); an IPv6 address by its /64 (one home or phone network holds a whole /64, so a
 * per-address key would be a fresh key per request). IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is IPv4; a
 * zone (`%eth0`) is dropped; anything else is returned unchanged.
 */
export function ipPrefix(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/%.*$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;
  const mapped = /^(?:0{0,4}:){0,4}:?(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped?.[1]) return mapped[1];
  if (!raw.includes(':') || !/^[0-9a-f:]+$/.test(raw)) return raw;
  const halves = raw.split('::');
  if (halves.length > 2) return raw;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) return raw;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((g) => g.length === 0 || g.length > 4)) return raw;
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
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
