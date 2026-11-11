import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * How OpenNext adapts the Next.js build to the Worker. Defaults: no incremental
 * (ISR) cache — every page renders per request, which is what a D1-backed app
 * with an admin wants until the CPU numbers say otherwise
 * (`npm run measure:cpu`; options in docs/recipes.md → Caching).
 */
export default defineCloudflareConfig({});
