import type { Metadata } from 'next';

import { GalleryApp } from '@/components/gallery/GalleryApp';

// Built once (plan p06 D6.3): `build:app` copies the prerendered HTML into the assets as
// `/__gallery/shell`, and `worker.ts` answers every `/g/<slug>` with it, the gallery's head and data
// injected. Nothing here may read D1 or the env.
export const dynamic = 'force-static';

// The only metadata: it emits `<meta name="memoria-gallery-head" content="1">`, the marker
// `worker.ts` replaces with the gallery's <title>, description and Open Graph tags (D6.4).
export const metadata: Metadata = { other: { 'memoria-gallery-head': '1' } };

export default function GalleryShellPage() {
  return <GalleryApp />;
}
