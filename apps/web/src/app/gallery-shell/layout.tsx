import { GALLERY_FONT_CLASSES } from '../galleryFonts';

/**
 * The client gallery's wrapper (plan p06 D6.2, D6.4). The shell is ONE static page for every gallery:
 * `worker.ts` adds `data-gallery-theme`, `data-gallery-accent` and `data-gallery-font` to this element
 * (the one carrying `GALLERY_FONT_CLASSES`: next/font's variables exist only where their class is), so
 * the attribute order matters — `data-gallery-root` comes first, it is the injection marker
 * (scripts/gallery-shell.mjs checks it). No D1, no env: this renders at build time.
 */
export default function GalleryShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-gallery-root="" className={GALLERY_FONT_CLASSES} suppressHydrationWarning>
      {children}
    </div>
  );
}
