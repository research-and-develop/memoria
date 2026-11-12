/**
 * The settings sections (D2.17), one registry like the sidebar's (`../nav.ts`). Pure.
 * Sections of later phases are listed as "Soon"; nav.test.ts checks pages both ways. Out of scope
 * and never listed: domain, storage, backups, a store, a team, integrations.
 */
export type SettingsSection = {
  id: string;
  label: string;
  href: string;
  soonPhase?: number;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'security', label: 'Security', href: '/admin/settings/security' },
  { id: 'branding', label: 'Branding', href: '/admin/settings/branding', soonPhase: 4 },
  { id: 'watermarks', label: 'Watermarks', href: '/admin/settings/watermarks', soonPhase: 4 },
  { id: 'emails', label: 'Emails', href: '/admin/settings/emails', soonPhase: 4 },
];

/** Where `/admin/settings` itself goes: the first built section. */
export const SETTINGS_HOME = SETTINGS_SECTIONS.find((s) => s.soonPhase === undefined)?.href ?? '/admin';

/** Also reachable from the settings list (not a section): the design-system page. */
export const DESIGN_SYSTEM_LINK = { label: 'Design system', href: '/admin/design' } as const;
