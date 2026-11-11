import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tailwind content globs for this package, as ABSOLUTE paths.
 *
 * Every app that renders `@repo/ui` must SPREAD these into its own `content`.
 * A preset cannot deliver them: Tailwind v3 does not merge `content` across
 * presets, so the app's own array replaces the preset's — the build stays green
 * and the primitives render unstyled. Guard: scripts/guards/tailwind-ui-content.test.ts.
 *
 * Absolute because Tailwind resolves relative globs against the build CWD,
 * which differs per app. Forward slashes because fast-glob reads a backslash as
 * an escape, so a raw Windows path matches nothing.
 */
const packageRoot = dirname(fileURLToPath(import.meta.url)).split(sep).join('/');

export const uiContentGlobs = [
  `${packageRoot}/**/*.{js,ts,jsx,tsx,mdx}`,
  // Tests are excluded: mock data reads as class names (`id: 'm-1'` emits a
  // real margin utility), and a deleted test file makes the incremental scan
  // ENOENT until `.next` is cleared.
  `!${packageRoot}/**/*.test.{ts,tsx}`,
];

/**
 * The design tokens. Placeholder values — replace them with your design's and
 * keep the NAMES (components and tests use them) or rename everywhere at once.
 * Every font-size and spacing key must also be in `cn.ts` (FONT_SIZE_TOKENS,
 * SPACING_TOKENS) — cn.test.ts fails until it is.
 *
 * Fonts are CSS variables set by the app's root layout (next/font):
 * `--font-display` (headings) and `--font-text` (everything else).
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  // Light-only until a dark theme is designed; `class` keeps any stray `dark:`
  // variant inert instead of following the OS setting.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4F6BD8',
          strong: '#3D56B8', // small text and filled buttons (AA on white, wash)
          deep: '#2F4594', // text on tinted chips
          soft: '#6F86E0',
          line: '#8A9DE6',
          border: '#C5CFF2',
          subtle: '#DFE5FA',
          tint: '#E6EBFC',
          wash: '#F1F4FD',
          on: '#EEF2FF', // body text on a brand surface
        },
        accent: {
          DEFAULT: '#F5B70A',
          strong: '#D99E00',
          tint: '#FFEFB8',
          wash: '#FFF8E3',
        },
        ink: {
          DEFAULT: '#1D2333',
          muted: '#565D70', // AA on every light surface
          subtle: '#868B99', // placeholders only
        },
        line: {
          DEFAULT: '#E2E6EF',
          soft: '#ECEFF6',
        },
        page: '#FCFDFF',
        danger: { DEFAULT: '#C2410C', strong: '#9A3412', wash: '#FFF1EB' },
        success: { DEFAULT: '#15803D', wash: '#ECFDF3' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-text)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      // The type scale. Fluid where a desktop size would not fit a 360 px phone.
      // Use through the typography primitives, not directly in screens.
      fontSize: {
        'display-xl': ['clamp(2.125rem, 1.15rem + 3.7vw, 4.25rem)', { lineHeight: '1.12', letterSpacing: '-0.01em' }],
        'display-lg': ['clamp(2rem, 1.3rem + 3vw, 3.5rem)', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
        'heading-xl': ['clamp(1.75rem, 1.3rem + 1.7vw, 2.625rem)', { lineHeight: '1.15' }],
        'heading-section': ['clamp(1.75rem, 1.4rem + 1.25vw, 2.375rem)', { lineHeight: '1.25' }],
        'heading-lg': ['clamp(1.5rem, 1.3rem + 0.8vw, 2rem)', { lineHeight: '1.2' }],
        'heading-md': ['clamp(1.25rem, 1.15rem + 0.45vw, 1.5rem)', { lineHeight: '1.4' }],
        'heading-sm': ['1.1875rem', { lineHeight: '1.45' }],
        'heading-xs': ['1.125rem', { lineHeight: '1.45' }],
        'lead-lg': ['clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem)', { lineHeight: '1.5' }],
        lead: ['1.0625rem', { lineHeight: '1.5' }],
        'body-lg': ['1.0625rem', { lineHeight: '1.55' }],
        body: ['1rem', { lineHeight: '1.5' }],
        nav: ['0.9375rem', { lineHeight: '1.45' }],
        'body-sm': ['0.875rem', { lineHeight: '1.45' }],
        label: ['0.8125rem', { lineHeight: '1.45' }],
        caption: ['0.75rem', { lineHeight: '1.4' }],
        eyebrow: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.04em' }],
        'eyebrow-sm': ['0.6875rem', { lineHeight: '1.45', letterSpacing: '0.04em' }],
        'eyebrow-xs': ['0.625rem', { lineHeight: '1.5', letterSpacing: '0.04em' }],
      },
      maxWidth: {
        content: '1264px', // a 1200 px column + the largest side padding
        prose: '45rem',
      },
      borderRadius: {
        field: '9px',
        panel: '28px',
      },
      spacing: {
        section: '4.5rem', // the vertical rhythm of every section
      },
      boxShadow: {
        card: '0 1px 2px rgba(29, 35, 51, 0.04), 0 8px 24px rgba(29, 35, 51, 0.06)',
      },
      ringColor: {
        DEFAULT: '#2F4594',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};
