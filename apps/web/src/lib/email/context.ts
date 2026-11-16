import type { Studio } from '@/lib/settings/parseStudioInput';
import { JobError } from '@/lib/jobs/types';

import type { EmailContext } from './types';

/** A path inside the site: `/` then no second `/`, no backslash, no whitespace or control character. */
const PATH_RE = /^\/(?![/\\])[^\s\\\p{Cc}]*$/u;

/**
 * The context every template renders with (D3.8), from the studio settings (`readStudio()`). Links
 * are only ever the website address + a path: a template cannot link elsewhere. Pure.
 */
export function emailContext(studio: Studio): EmailContext {
  return {
    studioName: studio.name,
    siteUrl: studio.siteUrl,
    link(path) {
      if (!PATH_RE.test(path)) throw new Error(`emailContext.link: not a site path: ${path}`);
      // No address known: retried, so setting one in Settings → Studio recovers the queue.
      if (!studio.siteUrl) throw new JobError('SITE_URL_MISSING');
      return `${studio.siteUrl}${path}`;
    },
  };
}
