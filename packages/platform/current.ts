import 'server-only';

/**
 * THE composition root: the one place that decides which platform Next code runs on. Domain code
 * calls `getPlatform()` from here, inside a request, never at import time.
 *
 * - Next on Cloudflare (dev, preview, production): the OpenNext wrapper below.
 * - vitest: aliased to ./testing/current.ts (vitest.config.ts), the test platform.
 * - A Docker build later: aliased to a Node platform (docs/architecture.md); not built yet.
 */
export { getPlatform } from '@repo/platform-cloudflare/next';
