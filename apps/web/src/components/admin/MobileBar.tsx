'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';

import { Icon } from './icons';

const DRAWER_ID = 'studio-menu';
/** Tailwind's `lg`: from here the sidebar shows and the drawer must close. */
const DESKTOP = '(min-width: 1024px)';

/**
 * Below `lg`: a top bar with the studio mark and a Menu button that opens the navigation in a
 * drawer (D2.16). `children` is the sidebar's content (rendered by the server). The drawer closes
 * on Esc, a click on the backdrop, the close button, a navigation, and when the window reaches `lg`.
 */
export function MobileBar({ mark, children }: { mark: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DESKTOP);
    const onChange = () => {
      if (query.matches) setOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4 lg:hidden">
      {mark}
      <Button
        variant="ghost"
        size="lg"
        className="-mr-2 gap-2 px-3"
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" size={20} />
        Menu
      </Button>
      <Dialog id={DRAWER_ID} variant="drawer" open={open} onClose={() => setOpen(false)} aria-label="Studio menu">
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between gap-3 border-b border-line px-4">
            {mark}
            <Button variant="ghost" size="icon" aria-label="Close menu" className="-mr-2 h-11 w-11" autoFocus onClick={() => setOpen(false)}>
              <Icon name="close" size={20} />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </Dialog>
    </header>
  );
}
