import './globals.css';

import type { Metadata, Viewport } from 'next';

import studio from '@repo/ui/theme/studio';

import { AppProvider } from '@/components/AppProvider';
import { getAppConfig } from '@/lib/config/appConfig';
import { getSiteUrl } from '@/lib/config/siteUrl';

import { monoFont, textFont } from './fonts';

// Every page reads the Worker env (and D1) per request. Next never caches a page
// itself here; add caching deliberately (docs/recipes.md → Caching).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { appName } = getAppConfig();
  return {
    metadataBase: new URL(await getSiteUrl()),
    title: { default: appName, template: `%s | ${appName}` },
  };
}

export const viewport: Viewport = {
  themeColor: studio.meta.themeColor,
  width: 'device-width',
  initialScale: 1,
};

/**
 * Fonts: `./fonts.ts` (next/font) sets `--font-text` and `--font-mono` through the
 * `variable` classes on <html>; the theme's font stacks read them, and globals.css
 * holds system fallbacks.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getAppConfig();
  return (
    <html lang="en" className={`${textFont.variable} ${monoFont.variable}`} data-scroll-behavior="smooth">
      <body className="bg-ground font-sans text-body text-ink antialiased">
        <AppProvider config={config}>{children}</AppProvider>
      </body>
    </html>
  );
}
