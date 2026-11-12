import { describe, expect, it } from 'vitest';

import preset from '../tailwind-preset.mjs';
import { flattenColors, hexToChannels, tailwindColors, themeCssVars } from './cssVars.mjs';
import studio from './studio.mjs';

const sample = { ground: '#F6F6F4', ink: { DEFAULT: '#16171A', muted: '#5D6066' } };

describe('theme colour roles → CSS variables', () => {
  it('flattens roles to Tailwind names', () => {
    expect(flattenColors(sample)).toEqual([
      ['ground', '#F6F6F4'],
      ['ink', '#16171A'],
      ['ink-muted', '#5D6066'],
    ]);
  });

  it.each([
    ['#000000', '0 0 0'],
    ['#FFFFFF', '255 255 255'],
    ['#1f6f5c', '31 111 92'],
  ])('%s → %s', (hex, channels) => {
    expect(hexToChannels(hex)).toBe(channels);
  });

  it.each(['#FFF', 'white', '#1F6F5CFF', 'rgb(0,0,0)'])('refuses %s (themes are #RRGGBB)', (bad) => {
    expect(() => hexToChannels(bad)).toThrow();
  });

  it('declares one variable per role', () => {
    expect(themeCssVars(sample)).toEqual({ '--color-ground': '246 246 244', '--color-ink': '22 23 26', '--color-ink-muted': '93 96 102' });
  });

  it('gives Tailwind a utility per role that reads its variable, keeping opacity modifiers', () => {
    expect(tailwindColors(sample)).toEqual({
      ground: 'rgb(var(--color-ground) / <alpha-value>)',
      ink: { DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)', muted: 'rgb(var(--color-ink-muted) / <alpha-value>)' },
    });
  });

  it('the preset knows exactly the studio roles (plus the CSS keywords), and every studio colour is valid', () => {
    const colors = (preset as unknown as { theme: { colors: Record<string, unknown> } }).theme.colors;
    expect(Object.keys(colors).sort()).toEqual([...Object.keys(studio.colors), 'current', 'inherit', 'transparent'].sort());
    expect(() => themeCssVars(studio.colors)).not.toThrow();
  });
});
