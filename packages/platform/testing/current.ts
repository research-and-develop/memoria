import type { Platform } from '../ports';

import { testPlatform } from './platform';

/**
 * What `@repo/platform/current` resolves to under vitest (vitest.config.ts → resolve.alias). The
 * real composition root, ../current.ts, chooses the Cloudflare platform. Same export, same type.
 */
export function getPlatform(): Platform {
  return testPlatform;
}
