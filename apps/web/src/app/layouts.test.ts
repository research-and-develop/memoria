import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Plan p06 D6.2: the root layout is static (the gallery shell under it is prerendered into an asset),
 * so what reads D1 per request must say so itself. A source check, like components/admin/nav.test.ts:
 * a route segment config is a static export Next reads at build time.
 */
const appDir = path.dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(path.join(appDir, file), 'utf8');

const FORCE_DYNAMIC = /export const dynamic = 'force-dynamic'/;
const ANY_DYNAMIC = /export const dynamic\b/;

describe('route segment config (plan p06 D6.2)', () => {
  it('the root layout is static: no dynamic, no config read, keeps the viewport', () => {
    const root = source('layout.tsx');
    expect(root).not.toMatch(ANY_DYNAMIC);
    expect(root).not.toMatch(/getAppConfig\(|<AppProvider|function generateMetadata/);
    expect(root).toMatch(/export const viewport\b/);
    expect(root).toMatch(/suppressHydrationWarning/);
  });

  it('the admin layout is dynamic and provides the config', () => {
    const admin = source('admin/layout.tsx');
    expect(admin).toMatch(FORCE_DYNAMIC);
    expect(admin).toMatch(/export async function generateMetadata\b/);
    expect(admin).toMatch(/<AppProvider config=\{config\}>/);
  });

  it('the home page is dynamic with its own metadata', () => {
    const home = source('page.tsx');
    expect(home).toMatch(FORCE_DYNAMIC);
    expect(home).toMatch(/export async function generateMetadata\b/);
  });

  it('the gallery shell is static and emits only the head marker', () => {
    const page = source('gallery-shell/page.tsx');
    expect(page).toMatch(/export const dynamic = 'force-static'/);
    expect(page).toMatch(/other: \{ 'memoria-gallery-head': '1' \}/);
    expect(source('gallery-shell/layout.tsx')).toMatch(/<div data-gallery-root="" className=\{GALLERY_FONT_CLASSES\}/);
  });

  it('the error and not-found pages carry a static title', () => {
    expect(source('not-found.tsx')).toMatch(/title: 'Page not found'/);
    expect(source('error.tsx')).toMatch(/<title>Something went wrong<\/title>/);
  });
});
