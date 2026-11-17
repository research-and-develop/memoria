import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import ts from 'typescript';

import { securityHeaders } from './src/lib/security/headers.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, '..', '..');

/**
 * The media origins the CSP must allow (plan p04 D4.15): `MEDIA_PUBLIC_BASE_URL` (images and the
 * watermark fetch) and `MEDIA_S3_ENDPOINT` (presigned PUTs), plain `vars` in wrangler.jsonc. Read at
 * BUILD time because the headers are fixed then: changing either needs a rebuild and deploy. JSONC is
 * parsed by TypeScript, as guard `wrangler-config` does; an empty value adds nothing.
 */
function mediaOrigins() {
  const file = path.join(appDir, 'wrangler.jsonc');
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
  if (error) throw new Error(`wrangler.jsonc: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`);
  const vars = config?.vars ?? {};
  return { publicBaseUrl: vars.MEDIA_PUBLIC_BASE_URL || null, s3Endpoint: vars.MEDIA_S3_ENDPOINT || null };
}

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
  // CSP (the studio profile, with the media origins), HSTS, X-Robots-Tag and friends on every route
  // (src/lib/security/headers.mjs).
  async headers() {
    const headers = securityHeaders({ dev: process.env.NODE_ENV !== 'production', profile: 'studio', media: mediaOrigins() });
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;

// `next dev` only: gives `getCloudflareContext().env` the bindings from
// wrangler.jsonc (the local D1 in `.wrangler/state`) and the vars/secrets from
// `.dev.vars`, so dev reads config exactly the way the deployed Worker does.
initOpenNextCloudflareForDev();
