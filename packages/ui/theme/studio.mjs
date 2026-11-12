/**
 * The studio theme: EVERY visual value of the admin UI lives here, and only here.
 *
 * To restyle the app, edit this file. Nothing else names a colour, a size or a radius:
 * - colours are ROLES (what a colour is for: `accent`, `surface`, `ink-muted`), never a hue
 *   (`green`, `white`). Components use the roles through Tailwind (`bg-accent`, `text-ink-muted`);
 *   the preset turns each role into a CSS variable (`--color-accent`), so a second theme is just
 *   another set of values for the same roles (`theme/cssVars.mjs`). Guard: no-raw-colors.
 * - the type scale, weights, radii, shadows and widths become Tailwind tokens (`text-body`,
 *   `font-title`, `rounded-card`, `shadow-control`). tailwind-merge learns their names from here
 *   (`cn.ts`), so adding a token needs no second edit.
 * - contrast: `colorContrast.test.ts` re-checks every text/surface pair against these values
 *   (WCAG AA), so a colour change that breaks legibility fails the suite.
 *
 * Source: docs/design/HANDOFF.md → Design tokens (Studio). Plain data, no imports: the preset
 * (Node), the tests and client components all read it.
 */

/** Colour roles, grouped. A key `DEFAULT` is the bare name (`ink`); others are `group-key` (`ink-muted`). */
export const colors = {
  /** Page background. */
  ground: '#F6F6F4',
  /** Cards, fields, header, menus: anything raised above the ground. */
  surface: '#FFFFFF',
  /** Subtle fill: hover, disabled fields, quiet cards, the segmented control's track. */
  wash: '#EEEEEB',
  ink: {
    /** Primary text; the dark button's fill. */
    DEFAULT: '#16171A',
    /** Secondary text. */
    2: '#3A3C41',
    /** Tertiary text and placeholders (AA on every surface). */
    muted: '#5D6066',
    /** Disabled text and decoration only (below AA). */
    faint: '#8A8C91',
    /** The dark button's hover fill. */
    hover: '#2C2E33',
  },
  line: {
    /** Dividers, card borders. */
    DEFAULT: '#E4E4E0',
    /** Secondary button border. */
    control: '#DADAD5',
    /** Form field border. */
    input: '#C9CAC4',
  },
  accent: {
    /** Primary actions, selection, links on light surfaces. */
    DEFAULT: '#1F6F5C',
    /** Accent text on a tint; the primary button's hover. */
    ink: '#17564A',
    /** Accent-tinted fill (selected rows, accent pills). */
    tint: '#EAF2EF',
  },
  /** Keyboard focus ring and focused field border. */
  focus: '#17564A',
  /** Text and icons on a filled surface (accent, ink, danger). */
  inverse: '#FFFFFF',
  /** Count badges and warnings: on `surface` only. */
  alert: '#B4530A',
  danger: {
    /** Destructive actions, error text. */
    DEFAULT: '#9B2C22',
    /** Error banner fill. */
    wash: '#F7E3E1',
  },
  // Gallery status pills: a fill and the text on it.
  live: { bg: '#E3F1EC', fg: '#17564A' },
  proofing: { bg: '#FCEFD9', fg: '#8A4B00' },
  draft: { bg: '#EEEEEB', fg: '#45474C' },
  scheduled: { bg: '#E4EBF8', fg: '#2747A0' },
  expired: { bg: '#F7E3E1', fg: '#9B2C22' },
};

/**
 * The type scale: [size, { lineHeight, letterSpacing? }]. Use it through the typography
 * primitives; a screen never sets a size of its own (guard: no-one-off-text-size).
 */
export const fontSize = {
  /** 11 px: badges, tab counts, avatar initials. */
  micro: ['0.6875rem', { lineHeight: '1.3' }],
  /** 12 px: meta lines, pills, filenames. */
  caption: ['0.75rem', { lineHeight: '1.4' }],
  /** 13 px: list rows, labels, secondary text. */
  'body-sm': ['0.8125rem', { lineHeight: '1.45' }],
  /** 14 px: the default. */
  body: ['0.875rem', { lineHeight: '1.45' }],
  /** 15 px: form fields from `sm` up. */
  'body-lg': ['0.9375rem', { lineHeight: '1.45' }],
  /** 16 px: form fields below `sm` (iOS zooms into a field under 16 px). */
  field: ['1rem', { lineHeight: '1.4' }],
  /** 16 px: card titles. */
  'title-sm': ['1rem', { lineHeight: '1.35' }],
  /** 17 px: settings section titles. */
  title: ['1.0625rem', { lineHeight: '1.35' }],
  /** 18 px: stat values, screen titles. */
  'title-lg': ['1.125rem', { lineHeight: '1.3' }],
  /** 24 px: a gallery's title in its manager. */
  heading: ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
  /** 26 px: the page greeting. */
  'heading-lg': ['1.625rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
  /** 28 px: KPI values. */
  stat: ['1.75rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
  /** 12 px uppercase labels. */
  eyebrow: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.08em' }],
};

/** Weights beyond Tailwind's (`font-semibold` 600 and `font-bold` 700 stay available). */
export const fontWeight = {
  /** Titles: between semibold and bold (Inter is a variable font). */
  title: '650',
};

/** Font stacks. The CSS variables are set by the app's root layout (next/font); globals.css has fallbacks. */
export const fontFamily = {
  sans: ['var(--font-text)', 'system-ui', 'sans-serif'],
  mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
};

export const borderRadius = {
  /** Fields, segmented control. */
  control: '8px',
  /** Buttons. */
  button: '10px',
  /** Cards. */
  card: '12px',
  /** Dialogs and large panels. */
  panel: '14px',
};

export const boxShadow = {
  /** A raised control (the selected segment). */
  control: '0 1px 2px rgba(0, 0, 0, 0.12)',
};

export const maxWidth = {
  /** The content column (Phase 2 sets the admin shell's own width). */
  content: '1264px',
  /** A comfortable reading width. */
  prose: '45rem',
};

/** Pixel values the components need outside Tailwind (the browser chrome colour). */
export const meta = {
  /** `<meta name="theme-color">`: the page background. */
  themeColor: colors.ground,
};

export const studioTheme = { colors, fontSize, fontWeight, fontFamily, borderRadius, boxShadow, maxWidth, meta };
export default studioTheme;
