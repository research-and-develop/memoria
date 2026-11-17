import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import preset from './tailwind-preset.mjs';

/**
 * The preset rendered through Tailwind: the gallery rules (theme/galleryAccent.mjs) reach the CSS, in
 * cascade order, after the studio's `:root`.
 */
async function render(): Promise<string> {
  const config = { presets: [preset], content: [{ raw: '<div class="bg-accent"></div>' }], corePlugins: { preflight: false } };
  const result = await postcss([tailwindcss(config)]).process('@tailwind base;', { from: undefined });
  return result.css;
}

describe('the Tailwind preset emits the gallery themes', () => {
  it('dark, auto, an accent rule, all after :root', async () => {
    const css = await render();
    const root = css.indexOf(':root');
    const darkRule = css.search(/\[data-gallery-theme="dark"\]\s*\{[^}]*--color-ground: 18 19 20;[^}]*color-scheme: dark/);
    const lightAuto = css.indexOf('[data-gallery-theme="auto"] {');
    const media = css.search(/@media \(prefers-color-scheme: dark\)\s*\{\s*\[data-gallery-theme="auto"\]/);
    const accent = css.search(/\[data-gallery-theme="dark"\]\[data-gallery-accent="navy"\]\s*\{[^}]*--color-accent: \d+ \d+ \d+/);
    expect(root).toBeGreaterThan(-1);
    for (const at of [darkRule, lightAuto, media, accent]) expect(at).toBeGreaterThan(root);
    expect(media).toBeGreaterThan(lightAuto);
  });
});
