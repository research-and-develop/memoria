import 'server-only';

import { perRender } from '@/lib/perRender';

import { readBranding } from './branding';

/** The studio's branding, read once per server render (server components only). */
export const getBranding = perRender(() => readBranding());
