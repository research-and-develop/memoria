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

  describe('the media origins (plan p04 D4.15)', () => {
    const media = { publicBaseUrl: 'https://media.example.com', s3Endpoint: 'https://acct.r2.cloudflarestorage.com' };
    const studio = directives(contentSecurityPolicy({ dev: false, profile: 'studio', media }));
    const gallery = directives(contentSecurityPolicy({ dev: false, profile: 'gallery', media }));

    it('studio: the media domain in img-src and connect-src, the S3 endpoint in connect-src', () => {
      expect(studio['img-src']).toContain(media.publicBaseUrl);
      expect(studio['connect-src']).toEqual(expect.arrayContaining([media.publicBaseUrl, media.s3Endpoint]));
      expect(studio['script-src']).toContain('https://static.cloudflareinsights.com');
    });

    it('gallery: the media domain in img-src; Turnstile and inline scripts kept; no beacon, no S3 endpoint', () => {
      expect(gallery['img-src']).toContain(media.publicBaseUrl);
      expect(gallery['script-src']).toEqual(expect.arrayContaining(['https://challenges.cloudflare.com', "'unsafe-inline'"]));
      expect(gallery['frame-src']).toContain('https://challenges.cloudflare.com');
      const all = Object.values(gallery).flat();
      expect(all).not.toContain('https://static.cloudflareinsights.com');
      expect(all).not.toContain('https://cloudflareinsights.com');
      expect(all).not.toContain(media.s3Endpoint);
    });

    it('empty vars (or none) leave the policy as it was', () => {
      const empty = contentSecurityPolicy({ dev: false, media: { publicBaseUrl: null, s3Endpoint: '' } });
      expect(empty).toBe(contentSecurityPolicy({ dev: false }));
      expect(directives(empty)['img-src']).toEqual(["'self'", 'data:', 'blob:']);
      expect(directives(empty)['connect-src']).toEqual(["'self'", 'https://cloudflareinsights.com']);
    });

    it('securityHeaders passes the profile and the origins through', () => {
      const csp = securityHeaders({ dev: false, profile: 'gallery', media }).find((h) => h.key === 'Content-Security-Policy')?.value;
      expect(csp).toBe(contentSecurityPolicy({ dev: false, profile: 'gallery', media }));
    });
  });

  it('tells crawlers not to index anything, in dev and production', () => {
    for (const dev of [false, true]) {
      expect(securityHeaders({ dev }).find((h) => h.key === 'X-Robots-Tag')?.value).toBe('noindex, nofollow');
    }
  });
});
