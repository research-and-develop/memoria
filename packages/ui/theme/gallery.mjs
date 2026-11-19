import studio from './studio.mjs';

/**
 * The client gallery's look: the SAME colour roles as the studio (`theme/studio.mjs`) with the
 * gallery's values, so every `@repo/ui` primitive works inside a gallery unchanged (plan p04 D4.4).
 * A gallery is themed by attributes on its root element, never by studio-only values:
 * `data-gallery-theme` (`light` | `dark` | `auto`), `data-gallery-accent` (a swatch id) and
 * `data-gallery-font` (a pairing id). The Tailwind preset emits the rules (`galleryAccent.mjs`).
 *
 * Source: docs/design/HANDOFF.md → Client gallery. `ground` = bg, `surface` = bg (cards sit flat in a
 * gallery), `wash` = the gallery surface, `ink` = fg, `ink-2` = `ink-muted` = muted (the design has one
 * secondary text colour), `line` = border. The accent roles here are Pine's (what a gallery without
 * `data-gallery-accent` shows); `galleryAccent.test.ts` checks they equal `galleryAccent('pine', …)`.
 * Roles a gallery does not use (`alert`, `danger`, the status pills) keep the studio's values.
 *
 * `inverse` is the text on an ACCENT fill (computed per swatch). In the dark theme `ink` is light,
 * so `bg-ink text-inverse` (the `dark` Button variant) is not legible there: gallery screens use the
 * `primary`, `secondary` and `ghost` variants. The primary hover is `accent-hover`, never `accent-ink`.
 *
 * Plain data plus one import: the preset (Node), the tests and client components read it.
 */

/** Studio roles a gallery does not use, kept so both maps have exactly the studio's keys. */
const unused = {
  alert: studio.colors.alert,
  danger: studio.colors.danger,
  live: studio.colors.live,
  proofing: studio.colors.proofing,
  draft: studio.colors.draft,
  scheduled: studio.colors.scheduled,
  expired: studio.colors.expired,
};

export const light = {
  ground: '#FBFAF7',
  surface: '#FBFAF7',
  wash: '#F1EFEA',
  ink: {
    DEFAULT: '#16171A',
    2: '#5D6066',
    muted: '#5D6066',
    /** Derived: the studio's disabled/decoration grey (below AA by design). */
    faint: '#8A8C91',
    /** Derived: the studio's dark-button hover. */
    hover: '#2C2E33',
  },
  line: {
    DEFAULT: '#DEDCD5',
    /** Derived: the border one step darker, for secondary buttons. */
    control: '#D3D1C9',
    /** Derived: two steps darker, for form fields. */
    input: '#C4C2BA',
  },
  accent: { DEFAULT: '#1F6F5C', ink: '#1F6F5C', tint: '#E1E9E4', hover: '#1B6251' },
  focus: '#1F6F5C',
  inverse: '#FFFFFF',
  /** Over a photo, like the studio's. */
  scrim: studio.colors.scrim,
  ...unused,
};

export const dark = {
  ground: '#121314',
  surface: '#121314',
  wash: '#1D1F21',
  ink: {
    DEFAULT: '#F1F0EC',
    2: '#A9ABAF',
    muted: '#A9ABAF',
    /** Derived: muted 40 % towards the ground (disabled and decoration only). */
    faint: '#6E7073',
    /** Derived: ink 10 % towards the ground, the light button's hover. */
    hover: '#D8D8D4',
  },
  line: {
    DEFAULT: '#34363A',
    /** Derived: the border one step lighter, for secondary buttons. */
    control: '#3E4044',
    /** Derived: two steps lighter, for form fields. */
    input: '#4C4E52',
  },
  accent: { DEFAULT: '#357D6C', ink: '#579385', tint: '#141E1D', hover: '#2F6E5F' },
  focus: '#579385',
  inverse: '#FFFFFF',
  /** Over a photo, like the studio's. */
  scrim: studio.colors.scrim,
  ...unused,
};

/**
 * Every gallery role map by theme name: each becomes a `[data-gallery-theme="<name>"]` rule set
 * (`galleryThemeRules()`), so a new map (Phase 6's lightbox) needs only an entry here.
 */
export const ROLE_MAPS = { light, dark };

/**
 * The accent swatches, in picker order (plan p04 D4.5; owner 2026-11-17: twelve). Stored by id: a
 * removed id reads as the default. A new colour is one entry here; the contrast tests iterate them.
 */
export const SWATCHES = Object.freeze(
  /** @type {const} */ ([
    { id: 'pine', label: 'Pine', hex: '#1F6F5C' },
    { id: 'teal', label: 'Teal', hex: '#1E6A78' },
    { id: 'olive', label: 'Olive', hex: '#5B6630' },
    { id: 'ochre', label: 'Ochre', hex: '#94650F' },
    { id: 'clay', label: 'Clay', hex: '#A4532E' },
    { id: 'rose', label: 'Rose', hex: '#B0476A' },
    { id: 'wine', label: 'Wine', hex: '#7A2E3A' },
    { id: 'plum', label: 'Plum', hex: '#6B3A6E' },
    { id: 'indigo', label: 'Indigo', hex: '#4B3F8C' },
    { id: 'navy', label: 'Navy', hex: '#2747A0' },
    { id: 'slate', label: 'Slate', hex: '#4A5866' },
    { id: 'ink', label: 'Ink', hex: '#16171A' },
  ]),
);

/** @typedef {typeof SWATCHES[number]['id']} AccentId */

/** @type {AccentId} */
export const DEFAULT_ACCENT = 'pine';

/**
 * A stored accent id → a known one (unknown → the default).
 * @param {unknown} id
 * @returns {AccentId}
 */
export function accentId(id) {
  return SWATCHES.find((s) => s.id === id)?.id ?? DEFAULT_ACCENT;
}

/** The theme choices of a gallery. */
export const GALLERY_THEMES = Object.freeze(/** @type {const} */ (['light', 'dark', 'auto']));
