import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, securityHeaders } from './headers.mjs';

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));
}

describe('security headers', () => {
  const prod = directives(contentSecurityPolicy({ dev: false }));
  const dev = directives(contentSecurityPolicy({ dev: true }));

  it.each([
    ['script-src', 'https://challenges.cloudflare.com'],
    ['frame-src', 'https://challenges.cloudflare.com'],
    ['script-src', 'https://static.cloudflareinsights.com'],
    ['connect-src', 'https://cloudflareinsights.com'],
    ['img-src', 'blob:'],
    ['frame-ancestors', "'none'"],
    ['object-src', "'none'"],
  ])('allows %s %s', (directive, source) => {
    expect(prod[directive]).toContain(source);
  });

  it('allows eval and the HMR socket only in dev', () => {
    expect(prod['script-src']).not.toContain("'unsafe-eval'");
    expect(prod['connect-src']).not.toContain('ws:');
    expect(dev['script-src']).toContain("'unsafe-eval'");
    expect(dev['connect-src']).toContain('ws:');
  });

  it('sends every header once', () => {
    const keys = securityHeaders({ dev: false }).map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining(['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']),
    );
  });

  it('tells crawlers not to index anything, in dev and production', () => {
    for (const dev of [false, true]) {
      expect(securityHeaders({ dev }).find((h) => h.key === 'X-Robots-Tag')?.value).toBe('noindex, nofollow');
    }
  });
});
