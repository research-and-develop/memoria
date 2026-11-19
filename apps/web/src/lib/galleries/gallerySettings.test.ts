import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEFAULT_ACCENT, GALLERY_THEMES } from '@repo/ui/theme/gallery';
import { DEFAULT_PAIRING } from '@repo/ui/theme/galleryFonts';

import { BRANDING_DEFAULTS, GRID_STYLES } from '@/lib/settings/parseBrandingInput';
import { GALLERY_DEFAULTS, LONG_EDGE_MAX, LONG_EDGE_MIN, QUALITY_MAX, QUALITY_MIN } from '@/lib/settings/parseGalleryDefaultsInput';

import { DEFAULT_GALLERY_SETTINGS, GALLERY_GRIDS, GALLERY_THEME_IDS, parseGallerySettings, SIZE_BOUNDS } from './gallerySettings';

describe('gallerySettings', () => {
  it('has no imports at all (worker.ts and the relay reach it)', () => {
    const source = readFileSync(new URL('./gallerySettings.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it('keeps its copies of the Phase 4 values in step', () => {
    expect(DEFAULT_GALLERY_SETTINGS.processing.display).toEqual(GALLERY_DEFAULTS.display.selection);
    expect(DEFAULT_GALLERY_SETTINGS.processing.thumb).toEqual(GALLERY_DEFAULTS.thumb);
    expect(SIZE_BOUNDS).toEqual({ longEdge: [LONG_EDGE_MIN, LONG_EDGE_MAX], quality: [QUALITY_MIN, QUALITY_MAX] });
    expect([DEFAULT_GALLERY_SETTINGS.accent, DEFAULT_GALLERY_SETTINGS.font]).toEqual([DEFAULT_ACCENT, DEFAULT_PAIRING]);
    expect([DEFAULT_GALLERY_SETTINGS.theme, DEFAULT_GALLERY_SETTINGS.grid]).toEqual([BRANDING_DEFAULTS.theme, BRANDING_DEFAULTS.grid]);
    expect([...GALLERY_THEME_IDS]).toEqual([...GALLERY_THEMES]);
    expect([...GALLERY_GRIDS]).toEqual([...GRID_STYLES]);
  });

  it('reads an empty object as the defaults, with nothing invalid', () => {
    expect(parseGallerySettings({})).toEqual({ value: DEFAULT_GALLERY_SETTINGS, invalid: [] });
    expect(parseGallerySettings('{"sort":"taken"}').value.sort).toBe('taken');
  });

  it.each([
    ['theme', { theme: 'sepia' }],
    ['accent', { accent: 'Not An Id' }],
    ['font', { font: 42 }],
    ['grid', { grid: 'grid' }],
    ['sort', { sort: 'random' }],
    ['welcome', { welcome: 'x'.repeat(1001) }],
    ['processing', { processing: { display: { longEdge: 100, quality: 75 }, thumb: { longEdge: 800, quality: 70 } } }],
    ['processing', { processing: { display: { longEdge: 1600, quality: 75 }, thumb: { longEdge: 800, quality: 70 }, watermark: 'yes' } }],
  ])('an invalid %s reads as its default and is reported', (field, settings) => {
    const { value, invalid } = parseGallerySettings(settings);
    expect(invalid).toEqual([field]);
    const key = field as keyof typeof value;
    expect(value[key]).toEqual(DEFAULT_GALLERY_SETTINGS[key]);
  });

  it('keeps a watermark snapshot and valid fields, and reports unreadable JSON', () => {
    const watermark = { kind: 'text', text: '© Studio', font: 'sans', ink: 'light', position: 'tiled', size: 20, opacity: 60, margin: 3 };
    const processing = { display: { longEdge: 2048, quality: 82 }, thumb: { longEdge: 800, quality: 70 }, watermark, ext: 'webp' };
    expect(parseGallerySettings({ processing, accent: 'rose', welcome: 'Hello' }).value).toMatchObject({ processing, accent: 'rose', welcome: 'Hello' });
    expect(parseGallerySettings('not json').invalid).toEqual(['settings']);
  });
});
