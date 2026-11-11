import './globals.css';

import type { Metadata, Viewport } from 'next';

import { AppProvider } from '@/components/AppProvider';
import { getAppConfig } from '@/lib/config/appConfig';
import { getSiteUrl } from '@/lib/config/siteUrl';

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
  themeColor: '#3D56B8',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Fonts: the preset reads `--font-text` and `--font-display` (globals.css sets
 * system stacks). For a web font, use `next/font` here and put its `variable`
 * class on <html> — it overrides the fallback variables.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getAppConfig();
  return (
    <html lang="en">
      <body className="bg-page font-sans text-ink antialiased">
        <AppProvider config={config}>{children}</AppProvider>
      </body>
    </html>
  );
}
