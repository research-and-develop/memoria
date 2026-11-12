import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tailwindColors, themeCssVars } from './theme/cssVars.mjs';
import studio from './theme/studio.mjs';

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
 * The design tokens, wired into Tailwind. The VALUES live in `theme/studio.mjs`: edit that file to
 * restyle the app. This preset only maps them:
 * - colours replace Tailwind's palette entirely (no `bg-blue-500` to drift to): each role reads its
 *   CSS variable, declared on `:root` from the studio theme by the plugin below (`theme/cssVars.mjs`);
 * - sizes, weights, radii, shadows and widths are used as they are.
 * tailwind-merge learns the token names from the same file (`cn.ts`).
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  // Light-only until a dark theme is designed; `class` keeps any stray `dark:`
  // variant inert instead of following the OS setting.
  darkMode: 'class',
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      ...tailwindColors(studio.colors),
    },
    extend: {
      fontFamily: studio.fontFamily,
      fontSize: studio.fontSize,
      fontWeight: studio.fontWeight,
      borderRadius: studio.borderRadius,
      boxShadow: studio.boxShadow,
      maxWidth: studio.maxWidth,
      // No custom spacing: Tailwind's scale. (A key here must also go into cn.ts SPACING_TOKENS.)
      spacing: {},
      ringColor: {
        DEFAULT: 'rgb(var(--color-focus) / <alpha-value>)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [
    /** @type {import('tailwindcss/types/config').PluginCreator} */
    ({ addBase, addVariant }) => {
      // The studio theme's colour variables; another theme overrides them on its own scope.
      addBase({ ':root': themeCssVars(studio.colors) });
      // Touch screens: `coarse:` styles (44 px hit areas).
      addVariant('coarse', '@media (pointer: coarse)');
    },
  ],
};
