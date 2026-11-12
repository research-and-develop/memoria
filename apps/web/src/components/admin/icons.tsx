/**
 * The studio's icons, inline SVG from the mockups (docs/design/Main.dc.html): 24-unit
 * strokes in `currentColor`, decorative (`aria-hidden`); the text next to them is the name.
 * No icon library.
 */
export type IconName = 'logo' | 'plus' | 'dashboard' | 'galleries' | 'selections' | 'insights' | 'settings' | 'menu' | 'close' | 'signOut';

const PATHS: Record<IconName, React.ReactNode> = {
  logo: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M14.3 8l5.7 9.9M9.7 8h11.5M7.4 12l5.7-9.9M9.7 16L4 6.1M14.3 16H2.8M16.6 12l-5.7 9.9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  dashboard: <path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  galleries: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  selections: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />,
  insights: <path d="M12 20V10M18 20V4M6 20v-4" />,
  settings: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
  signOut: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
};

export function Icon({ name, size = 18, strokeWidth = 1.75, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
