import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast.mjs';
import { themeCssVars } from './cssVars.mjs';
import { dark, light, ROLE_MAPS, SWATCHES } from './gallery.mjs';
import { ACCENT_MIN, contrastText, galleryAccent, galleryThemeRules, mix, TEXT_MIN } from './galleryAccent.mjs';

const THEMES = { light, dark } as const;
const CASES = SWATCHES.flatMap((s) => (['light', 'dark'] as const).map((theme) => [s.id, theme] as const));

describe('mix', () => {
  it.each([
    ['#1F6F5C', '#FFFFFF', 0, '#1F6F5C'],
    ['#1F6F5C', '#FFFFFF', 1, '#FFFFFF'],
    ['#1F6F5C', '#000000', 1, '#000000'],
    ['#000000', '#FFFFFF', 0.5, '#808080'], // 127.5 rounds up
    ['#1F6F5C', '#FFFFFF', 0.1, '#357D6C'], // 31 + 22.4 = 53.4 → 53 …
    ['#FBFAF7', '#1F6F5C', 0.12, '#E1E9E4'],
  ])('mix(%s, %s, %s) = %s', (hex, target, t, expected) => {
    expect(mix(hex, target, t)).toBe(expected);
  });
});

describe('contrastText', () => {
  it.each([
    ['#1F6F5C', '#FFFFFF'],
    ['#F1F0EC', '#16171A'],
    ['#FFFFFF', '#16171A'],
  ])('on %s → %s', (fill, text) => {
    expect(contrastText(fill)).toBe(text);
  });

  it('falls back to pure black when neither white nor the near-black reaches 4.5:1', () => {
    const mid = '#787878';
    expect(contrastRatio('#FFFFFF', mid)).toBeLessThan(TEXT_MIN);
    expect(contrastRatio('#16171A', mid)).toBeLessThan(TEXT_MIN);
    expect(contrastText(mid)).toBe('#000000');
  });

  it('pure black or white always reaches 4.5:1 (the worst grey gives ≈ 4.58), so it never returns null', () => {
    for (let v = 0; v < 256; v++) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`.toUpperCase();
      expect(contrastText(hex)).not.toBeNull();
    }
  });
});

describe('galleryAccent: every swatch in every theme is legible', () => {
  it.each(CASES)('%s on %s', (id, theme) => {
    const { ground, wash } = THEMES[theme];
    const roles = galleryAccent(id, theme);
    for (const surface of [ground, wash]) {
      expect(contrastRatio(roles.accent.DEFAULT, surface)).toBeGreaterThanOrEqual(ACCENT_MIN);
      expect(contrastRatio(roles.accent.ink, surface)).toBeGreaterThanOrEqual(TEXT_MIN);
    }
    expect(contrastRatio(roles.accent.ink, roles.accent.tint)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastRatio(roles.inverse, roles.accent.DEFAULT)).toBeGreaterThanOrEqual(TEXT_MIN);
    // The primary button's hover: its text keeps AA and the hover is visible.
    expect(contrastRatio(roles.inverse, roles.accent.hover)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastRatio(roles.inverse, roles.accent.hover)).toBeGreaterThan(contrastRatio(roles.inverse, roles.accent.DEFAULT));
    expect(roles.focus).toBe(roles.accent.ink);
    expect(roles.accent.tint).toBe(mix(ground, SWATCHES.find((s) => s.id === id)!.hex, 0.12));
  });

  it('a swatch that passes is used as it is (Pine on light)', () => {
    expect(galleryAccent('pine', 'light')).toMatchObject({ accent: { DEFAULT: '#1F6F5C', ink: '#1F6F5C' }, inverse: '#FFFFFF' });
  });

  it('mixing stops at the first passing step (Pine on dark: one step for the fill)', () => {
    const roles = galleryAccent('pine', 'dark');
    expect(roles.accent.DEFAULT).toBe(mix('#1F6F5C', '#FFFFFF', 0.05 * 2));
    expect(contrastRatio(mix('#1F6F5C', '#FFFFFF', 0.05), dark.wash)).toBeLessThan(ACCENT_MIN);
  });

  it('both directions: Ochre is darkened for text on light and its fill is unchanged on dark', () => {
    const lightOchre = galleryAccent('ochre', 'light');
    expect(lightOchre.accent.DEFAULT).toBe('#94650F');
    expect(lightOchre.accent.ink).toBe(mix('#94650F', '#000000', 0.05));
    expect(galleryAccent('ochre', 'dark').accent.DEFAULT).toBe('#94650F');
  });

  it('both directions: Clay and Rose are darkened for text on light (accent-ink on their own tint), lightened on dark', () => {
    for (const [id, hex] of [
      ['clay', '#A4532E'],
      ['rose', '#B0476A'],
    ] as const) {
      const onLight = galleryAccent(id, 'light');
      expect(onLight.accent.DEFAULT).toBe(hex);
      expect(contrastRatio(hex, onLight.accent.tint)).toBeLessThan(TEXT_MIN);
      expect(onLight.accent.ink).toBe(mix(hex, '#000000', 0.05));
      expect(contrastRatio(galleryAccent(id, 'dark').accent.ink, '#FFFFFF')).toBeLessThan(contrastRatio(hex, '#FFFFFF'));
    }
  });

  it('why accent-hover exists: accent-ink is lighter than the accent on dark, under white text', () => {
    for (const s of SWATCHES) {
      const roles = galleryAccent(s.id, 'dark');
      expect(contrastRatio(roles.inverse, roles.accent.ink)).toBeLessThan(TEXT_MIN);
    }
  });

  it('on dark every other fill is lightened', () => {
    for (const s of SWATCHES.filter((x) => x.id !== 'ochre')) expect(galleryAccent(s.id, 'dark').accent.DEFAULT).not.toBe(s.hex);
  });

  it('the theme maps carry Pine (what a gallery without data-gallery-accent shows)', () => {
    for (const theme of ['light', 'dark'] as const) {
      const pine = galleryAccent('pine', theme);
      const map = THEMES[theme];
      expect({ accent: map.accent, focus: map.focus, inverse: map.inverse }).toEqual(pine);
    }
  });

  it('refuses an unknown swatch', () => {
    expect(() => galleryAccent('nope', 'light')).toThrow();
  });
});

describe('galleryThemeRules', () => {
  const rules = galleryThemeRules();
  const index = (selector: string, media?: string) => rules.findIndex((r) => r.selector === selector && r.media === media);

  it('one rule set per role map, with its colour scheme', () => {
    for (const [name, map] of Object.entries(ROLE_MAPS)) {
      const rule = rules[index(`[data-gallery-theme="${name}"]`)];
      expect(rule?.vars).toEqual({ ...themeCssVars(map), 'color-scheme': name === 'dark' ? 'dark' : 'light' });
    }
  });

  it('auto: light, then dark inside the media query, after the light rule', () => {
    const lightAuto = index('[data-gallery-theme="auto"]');
    const darkAuto = index('[data-gallery-theme="auto"]', '(prefers-color-scheme: dark)');
    expect(lightAuto).toBeGreaterThan(-1);
    expect(darkAuto).toBeGreaterThan(lightAuto);
    expect(rules[darkAuto]?.vars['--color-ground']).toBe('18 19 20');
    expect(rules[darkAuto]?.vars['color-scheme']).toBe('dark');
  });

  it('three accent rules per swatch, after every theme rule', () => {
    const accentRules = rules.filter((r) => r.selector.includes('data-gallery-accent'));
    expect(accentRules).toHaveLength(SWATCHES.length * 3);
    const firstAccent = rules.findIndex((r) => r.selector.includes('data-gallery-accent'));
    const lastTheme = Math.max(...rules.map((r, i) => (r.selector.includes('data-gallery-accent') ? -1 : i)));
    expect(firstAccent).toBeGreaterThan(lastTheme);
    const navyDark = rules.find((r) => r.selector === '[data-gallery-theme="dark"][data-gallery-accent="navy"]');
    expect(navyDark?.vars).toEqual(themeCssVars(galleryAccent('navy', 'dark')));
    const navyAutoDark = index('[data-gallery-theme="auto"][data-gallery-accent="navy"]', '(prefers-color-scheme: dark)');
    expect(navyAutoDark).toBeGreaterThan(index('[data-gallery-theme="light"][data-gallery-accent="navy"], [data-gallery-theme="auto"][data-gallery-accent="navy"]'));
  });
});
