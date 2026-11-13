import 'server-only';

import { perRender } from '@/lib/perRender';

import { readStudio } from './studio';

/** The studio settings, read once per server render (server components only). */
export const getStudio = perRender(() => readStudio());
