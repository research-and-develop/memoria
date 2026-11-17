import 'server-only';

import { perRender } from '@/lib/perRender';

import { readWatermark } from './watermark';

/** The studio's watermark, read once per server render (server components only). */
export const getWatermark = perRender(() => readWatermark());
