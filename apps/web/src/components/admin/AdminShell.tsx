import { MobileBar } from './MobileBar';
import { SidebarContent, StudioMark } from './Sidebar';

/**
 * The studio's frame around every admin page (Main.dc.html): from `lg` a fixed sidebar beside the
 * content; below it a top bar whose Menu opens the same navigation in a drawer. A skip link jumps
 * past the navigation to `<main>`.
 */
export function AdminShell({ appName, children }: { appName: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ground lg:flex">
      <a
        href="#content"
        className="sr-only z-20 rounded-control bg-surface font-sans text-body font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:px-4 focus:py-3 focus:shadow-control"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-sidebar shrink-0 overflow-y-auto border-r border-line bg-surface lg:block">
        <SidebarContent appName={appName} />
      </aside>
      <MobileBar mark={<StudioMark appName={appName} />}>
        <SidebarContent appName={appName} showMark={false} />
      </MobileBar>
      <main id="content" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-12 pt-6 focus:outline-none sm:px-6 lg:px-10 lg:pt-7">
        <div className="mx-auto max-w-content">{children}</div>
      </main>
    </div>
  );
}
