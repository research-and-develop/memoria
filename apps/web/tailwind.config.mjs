import uiPreset, { uiContentGlobs } from '@repo/ui/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  // darkMode, theme and plugins come from the preset. `uiContentGlobs` must be
  // SPREAD here — Tailwind v3 does not merge `content` across presets, and
  // forgetting it renders every @repo/ui primitive unstyled with a green build.
  // Guard: scripts/guards/tailwind-ui-content.test.ts.
  presets: [uiPreset],
  content: [
    ...uiContentGlobs,
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    // Relative, so anchored at the build CWD (`apps/web`; the scripts run
    // through the workspace).
    '!./src/**/*.test.{ts,tsx}',
  ],
};
