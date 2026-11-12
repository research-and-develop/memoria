import { Text } from '@repo/ui/typography';

import { Icon } from './icons';
import { LogoutButton } from './LogoutButton';
import { NavList, NewGalleryAction } from './NavList';

/** The studio's mark and name, top of the sidebar and the mobile bar. */
export function StudioMark({ appName }: { appName: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <Icon name="logo" size={28} className="shrink-0 text-ink" />
      <Text weight="bold" size="body-lg" className="truncate">
        {appName}
      </Text>
    </span>
  );
}

/**
 * What the sidebar holds (Main.dc.html): mark, New gallery, the links, Sign out. The same content
 * sits in the desktop sidebar and in the mobile drawer; only one of them is ever displayed.
 */
export function SidebarContent({ appName, showMark = true }: { appName: string; showMark?: boolean }) {
  return (
    <nav aria-label="Studio" className="flex h-full flex-col gap-5 px-3.5 py-5">
      {showMark ? (
        <div className="px-2 py-1">
          <StudioMark appName={appName} />
        </div>
      ) : null}
      <NewGalleryAction />
      <NavList />
      <div className="mt-auto border-t border-line pt-3">
        <LogoutButton block />
      </div>
    </nav>
  );
}
