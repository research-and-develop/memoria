/**
 * Security headers for every response, used by next.config.mjs and tested in
 * headers.test.ts.
 *
 * The CSP allows only what the app loads. Add an origin here (with a test row)
 * when you embed something new — a blocked script fails silently in production.
 * - Turnstile — script + iframe from challenges.cloudflare.com;
 * - Cloudflare Web Analytics — the beacon script from
 *   static.cloudflareinsights.com, reporting to cloudflareinsights.com
 *   (harmless when the beacon is not used);
 * - `blob:` images for upload previews, `data:` for tiny inline SVGs.
 * `'unsafe-inline'` scripts are required: Next inlines the RSC payload, and the
 * nonce alternative makes every page dynamic (no edge caching at all).
 * Dev adds `'unsafe-eval'` (React's dev build) and the HMR websocket.
 *
 * `X-Robots-Tag: noindex, nofollow` on everything: nothing in Memoria is meant for search engines.
 * robots.txt does NOT disallow the public pages, or link-preview bots could not fetch a shared
 * gallery link and crawlers would never see this header. worker.ts responses set it too
 * (src/lib/edge/routes.ts).
 */

const TURNSTILE = 'https://challenges.cloudflare.com';
const BEACON_SCRIPT = 'https://static.cloudflareinsights.com';
const BEACON_REPORT = 'https://cloudflareinsights.com';

/** @param {{ dev: boolean }} opts */
export function contentSecurityPolicy({ dev }) {
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), TURNSTILE, BEACON_SCRIPT],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", BEACON_REPORT, ...(dev ? ['ws:'] : [])],
    'frame-src': [TURNSTILE],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** @param {{ dev: boolean }} opts @returns {{ key: string; value: string }[]} */
export function securityHeaders({ dev }) {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy({ dev }) },
    // Browsers ignore HSTS over plain http, so localhost is unaffected.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  ];
}
