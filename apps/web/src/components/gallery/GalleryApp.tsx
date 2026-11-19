'use client';

/**
 * The client gallery (plan p06 T6.5). Today the fixed placeholder the static shell renders and
 * hydrates (S6.1); commit 5 reads the view JSON `worker.ts` injects (`#__gallery`) after this first
 * render, so the server and client markup always agree (D6.4).
 */
export function GalleryApp() {
  return <main id="gallery" aria-busy="true" />;
}
