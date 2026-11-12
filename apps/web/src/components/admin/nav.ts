/**
 * The studio's navigation: ONE registry for the sidebar and the mobile drawer (D2.15). Pure.
 *
 * An item for a later phase stays listed, not linked, marked "Soon" (`soonPhase`), so the app's
 * full shape is visible without dead links. The phase that builds a screen adds its page and
 * drops the flag: nav.test.ts checks that every built item has a page and no Soon item has one.
 *
 * Never listed: a store, orders or prices (no sales features), or a clients screen (clients are
 * seen per gallery). nav.test.ts checks that too.
 */
import type { IconName } from './icons';

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  /** The phase that builds it; set = shown as "Soon", not a link. */
  soonPhase?: number;
};

/** The sidebar's primary action. */
export const NEW_GALLERY: NavItem = { id: 'new-gallery', label: 'New gallery', href: '/admin/galleries/new', icon: 'plus', soonPhase: 5 };

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/admin', icon: 'dashboard' },
  { id: 'galleries', label: 'Galleries', href: '/admin/galleries', icon: 'galleries', soonPhase: 5 },
  { id: 'selections', label: 'Selections', href: '/admin/selections', icon: 'selections', soonPhase: 8 },
  { id: 'insights', label: 'Insights', href: '/admin/insights', icon: 'insights', soonPhase: 11 },
  { id: 'settings', label: 'Settings', href: '/admin/settings', icon: 'settings' },
];

/**
 * Is `item` the current page? The dashboard only on `/admin` itself; any other item also on the
 * pages under it (`/admin/settings/security` is Settings).
 */
export function isCurrent(item: NavItem, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (item.href === '/admin') return path === '/admin';
  return path === item.href || path.startsWith(`${item.href}/`);
}
