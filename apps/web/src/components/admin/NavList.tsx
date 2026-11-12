'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { twMerge as cn } from '@repo/ui/cn';
import { Pill } from '@repo/ui/layout';

import { Icon } from './icons';
import { isCurrent, NAV_ITEMS, NEW_GALLERY, type NavItem } from './nav';

const ROW = 'flex min-h-11 items-center gap-2.5 rounded-control px-3 font-sans text-body';

/** "Soon": shown, not a link, not focusable; read once as "Galleries, not available yet". */
function SoonLabel({ item, onWash = false }: { item: NavItem; onWash?: boolean }) {
  return (
    <>
      <span className="flex-1">{item.label}</span>
      <span className="sr-only">, not available yet</span>
      <span aria-hidden>
        <Pill tone="draft" size="sm" className={onWash ? 'bg-surface' : undefined}>
          Soon
        </Pill>
      </span>
    </>
  );
}

/** The sidebar's links, the current page marked (`aria-current`). */
export function NavList() {
  const pathname = usePathname() ?? '';
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        if (item.soonPhase !== undefined) {
          return (
            <li key={item.id} className={cn(ROW, 'font-medium text-ink-muted')}>
              <Icon name={item.icon} />
              <SoonLabel item={item} />
            </li>
          );
        }
        const current = isCurrent(item, pathname);
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              aria-current={current ? 'page' : undefined}
              className={cn(ROW, current ? 'bg-accent-tint font-semibold text-accent-ink' : 'font-medium text-ink-2 hover:bg-wash')}
            >
              <Icon name={item.icon} />
              <span className="flex-1">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The primary action: the dark button, or while it is Soon a quiet block that does not look tappable. */
export function NewGalleryAction() {
  const item = NEW_GALLERY;
  if (item.soonPhase !== undefined) {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-button bg-wash px-3 font-sans text-body font-semibold text-ink-muted">
        <Icon name={item.icon} strokeWidth={2} />
        <SoonLabel item={item} onWash />
      </div>
    );
  }
  return (
    <Link
      href={item.href}
      className="flex min-h-11 items-center justify-center gap-2 rounded-button bg-ink font-sans text-body font-semibold text-inverse hover:bg-ink-hover"
    >
      <Icon name={item.icon} strokeWidth={2} />
      {item.label}
    </Link>
  );
}
