import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '@repo/core/testing/sourceIndex';

import { isCurrent, NAV_ITEMS, NEW_GALLERY, type NavItem } from './nav';

const PANEL = path.join(repoRoot(), 'apps/web/src/app/admin/(panel)');
const ALL: readonly NavItem[] = [NEW_GALLERY, ...NAV_ITEMS];

/** The page that serves an admin href (`/admin/x/y` → `(panel)/x/y/page.tsx`). */
const pageFor = (href: string) => path.join(PANEL, ...href.replace(/^\/admin\/?/, '').split('/').filter(Boolean), 'page.tsx');

describe('the studio navigation registry', () => {
  it('finds the panel pages (else the checks below pass for the wrong reason)', () => {
    expect(existsSync(pageFor('/admin'))).toBe(true);
  });

  it.each(ALL.filter((i) => i.soonPhase === undefined).map((i) => [i.id, i.href]))('built item %s has a page at %s', (_id, href) => {
    expect(existsSync(pageFor(href))).toBe(true);
  });

  it.each(ALL.filter((i) => i.soonPhase !== undefined).map((i) => [i.id, i.href]))(
    '"Soon" item %s has no page at %s yet (the phase that adds it drops the flag)',
    (_id, href) => {
      expect(existsSync(pageFor(href))).toBe(false);
    },
  );

  it('has unique ids and hrefs under /admin', () => {
    expect(new Set(ALL.map((i) => i.id)).size).toBe(ALL.length);
    expect(new Set(ALL.map((i) => i.href)).size).toBe(ALL.length);
    for (const item of ALL) expect(item.href).toMatch(/^\/admin(\/|$)/);
  });

  it('never lists a store, orders, prices or a clients screen (no sales features)', () => {
    for (const item of ALL) expect(`${item.id} ${item.label} ${item.href}`).not.toMatch(/store|order|price|billing|client/i);
  });

  it.each([
    ['dashboard', '/admin', true],
    ['dashboard', '/admin/', true],
    ['dashboard', '/admin/settings', false],
    ['settings', '/admin/settings', true],
    ['settings', '/admin/settings/security', true],
    ['settings', '/admin/settingsx', false],
    ['galleries', '/admin/galleries/new', true],
  ])('isCurrent(%s, %s) → %s', (id, pathname, expected) => {
    const item = ALL.find((i) => i.id === id);
    expect(item && isCurrent(item, pathname)).toBe(expected);
  });
});
