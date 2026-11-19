import './globals.css';

import type { Viewport } from 'next';

import studio from '@repo/ui/theme/studio';

import { monoFont, textFont } from './fonts';

export const viewport: Viewport = {
  themeColor: studio.meta.themeColor,
  width: 'device-width',
  initialScale: 1,
};

/**
 * The one root layout, STATIC (plan p06 D6.2): no D1, no env, no `force-dynamic`, so the gallery
 * shell under it can be prerendered into an asset. What reads config per request says so itself:
 * `app/admin/layout.tsx` (the admin's config and `AppProvider`), `app/page.tsx`. A new public page that
 * reads D1 must declare `dynamic = 'force-dynamic'` (docs/recipes.md → Caching).
 *
 * Fonts: `./fonts.ts` (next/font) sets `--font-text` and `--font-mono` through the `variable` classes
 * on <html>; the theme's font stacks read them, and globals.css holds system fallbacks.
 * `suppressHydrationWarning`: `worker.ts` injects `lang` and `data-gallery-theme` into the gallery
 * shell's <html> (D6.4).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${textFont.variable} ${monoFont.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="bg-ground font-sans text-body text-ink antialiased">{children}</body>
    </html>
  );
}
