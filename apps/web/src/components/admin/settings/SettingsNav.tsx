'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { twMerge } from '@repo/ui/cn';
import { Pill } from '@repo/ui/layout';

import { DESIGN_SYSTEM_LINK, SETTINGS_SECTIONS } from './nav';

const ITEM = 'relative flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-control px-3 font-sans text-body';

/**
 * The settings sections: links with `aria-current` (routes, so not a tablist). A column beside the
 * content from `lg`; below it a row that scrolls sideways above the content.
 */
export function SettingsNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Settings" className="relative -mx-4 overflow-x-auto px-4 [scrollbar-width:thin] sm:-mx-6 sm:px-6 lg:mx-0 lg:w-48 lg:shrink-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {SETTINGS_SECTIONS.map((section) =>
          section.soonPhase !== undefined ? (
            <li key={section.id} className={twMerge(ITEM, 'font-medium text-ink-muted')}>
              {section.label}
              <span className="sr-only">, not available yet</span>
              <span aria-hidden>
                <Pill tone="draft" size="sm">
                  Soon
                </Pill>
              </span>
            </li>
          ) : (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={pathname === section.href ? 'page' : undefined}
                className={twMerge(
                  ITEM,
                  pathname === section.href ? 'bg-accent-tint font-semibold text-accent-ink' : 'font-medium text-ink-2 hover:bg-wash',
                )}
              >
                {section.label}
              </Link>
            </li>
          ),
        )}
        <li className="lg:mt-3 lg:border-t lg:border-line lg:pt-3">
          <Link href={DESIGN_SYSTEM_LINK.href} className={twMerge(ITEM, 'font-medium text-ink-2 hover:bg-wash')}>
            {DESIGN_SYSTEM_LINK.label}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
