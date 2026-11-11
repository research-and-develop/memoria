import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

import { securityHeaders } from './src/lib/security/headers.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // One HTML for every visitor: metadata always in <head>. Otherwise Next
  // streams it into <body> for browsers and blocks only for the link-preview
  // bots it knows — and a cached browser page breaks the social previews.
  htmlLimitedBots: /.*/,
  // The app imports `@repo/*` from outside its own directory, so both the
  // tracing root and Turbopack's root must be the WORKSPACE root — otherwise
  // tracing silently misses the packages and Turbopack refuses to resolve them.
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
  // CSP, HSTS and friends on every route (src/lib/security/headers.mjs).
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders({ dev: process.env.NODE_ENV !== 'production' }) },
      // Belt and braces next to robots.txt and the admin's `noindex` metadata.
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/admin', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default nextConfig;

// `next dev` only: gives `getCloudflareContext().env` the bindings from
// wrangler.jsonc (the local D1 in `.wrangler/state`) and the vars/secrets from
// `.dev.vars`, so dev reads config exactly the way the deployed Worker does.
initOpenNextCloudflareForDev();
