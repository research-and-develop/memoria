import 'server-only';

import { perRender } from '@/lib/perRender';

import { readGalleryDefaults } from './galleryDefaults';

/** The new-gallery defaults, read once per server render (server components only). */
export const getGalleryDefaults = perRender(() => readGalleryDefaults());
