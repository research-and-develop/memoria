'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { FormField, Input, Select } from '@repo/ui/input';
import { RadioCards } from '@repo/ui/radioCards';
import { Segmented } from '@repo/ui/segmented';
import { SwatchPicker } from '@repo/ui/swatchPicker';
import { SWATCHES } from '@repo/ui/theme/gallery';
import { PAIRINGS } from '@repo/ui/theme/galleryFonts';
import { Toggle } from '@repo/ui/toggle';
import { Caption, Display, Mono, Text } from '@repo/ui/typography';

import { GALLERY_FONT_CLASSES } from '@/app/galleryFonts';
import { FormNote } from '@/components/admin/login/StepHeading';
import { SettingsCard } from '@/components/admin/settings/SettingsCard';
import type { GalleryGrid, GallerySort, GalleryTheme } from '@/lib/galleries/gallerySettings';
import { generateGalleryPassword, PASSWORD_MAX, PASSWORD_MIN } from '@/lib/galleries/password';
import { slugBase as slugFromTitle, SUFFIX_LENGTH } from '@/lib/galleries/slug';
import type { GalleryDefaults, Size } from '@/lib/settings/parseGalleryDefaultsInput';

type Branding = { theme: GalleryTheme; accent: string; font: string; grid: GalleryGrid };
type Purpose = 'selection' | 'sharing';
type Access = 'link' | 'password';
type Created = { id: string; slug: string };

const PURPOSES = [
  {
    value: 'selection',
    label: 'Selection',
    description: 'Your client chooses favourites. They see smaller, watermarked previews; full-size files can’t be downloaded. You deliver later.',
  },
  { value: 'sharing', label: 'Sharing', description: 'Final photos. Full-size downloads when downloads open.' },
] as const;
const ACCESS = [
  { value: 'link', label: 'Anyone with the link' },
  { value: 'password', label: 'Password' },
] as const;
const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
] as const;
const GRIDS = [
  { value: 'masonry', label: 'Masonry' },
  { value: 'justified', label: 'Justified' },
  { value: 'square', label: 'Square' },
] as const;
const SORTS = [
  { value: 'filename', label: 'Filename' },
  { value: 'taken', label: 'Capture time' },
] as const;

/**
 * New gallery (plan p05 → Screens): one column of cards in the mockup's order, a live cover preview on
 * the right from `lg`. Everything starts from the studio's defaults (Phase 4); the purpose sets the
 * preview size and whether the watermark is baked. Create → the gallery's page.
 */
export function NewGalleryForm({ defaults, branding, watermark }: { defaults: GalleryDefaults; branding: Branding; watermark: { kind: 'none' | 'image' | 'text'; label: string } }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [shootDate, setShootDate] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [slugBase, setSlugBase] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<Purpose>(defaults.purpose);
  const [access, setAccess] = useState<Access>(defaults.access);
  const [password, setPassword] = useState('');
  const [theme, setTheme] = useState<GalleryTheme>(branding.theme);
  const [accent, setAccent] = useState(branding.accent);
  const [font, setFont] = useState(branding.font);
  const [grid, setGrid] = useState<GalleryGrid>(branding.grid);
  const [sort, setSort] = useState<GallerySort>('filename');
  const hasWatermark = watermark.kind !== 'none';
  const [watermarkOn, setWatermarkOn] = useState(hasWatermark && defaults.purpose === 'selection' && defaults.watermarkSelection);
  const [display, setDisplay] = useState<Record<Purpose, Size>>(defaults.display);
  const [thumb] = useState<Size>(defaults.thumb);
  const { execute, loading, error } = useApi<Created>('/api/admin/galleries', { method: 'POST' });

  const details = error?.details as { field?: string; message?: string } | undefined;
  const field = details?.field;
  // The user-facing sentence is `details.message`; `error` itself is the code's English summary.
  const message = error ? (details?.message ?? 'The gallery could not be created. Try again.') : null;
  const errorFor = (name: string) => (field === name ? message : null);
  const readable = slugBase ?? slugFromTitle(title);

  const choosePurpose = (next: Purpose) => {
    setPurpose(next);
    setWatermarkOn(hasWatermark && next === 'selection' && defaults.watermarkSelection);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await execute({
      title,
      shootDate: shootDate || null,
      clientName: clientName || null,
      clientEmail: clientEmail || null,
      slugBase,
      purpose,
      access,
      password: access === 'password' ? password : null,
      display: display[purpose],
      thumb,
      watermark: watermarkOn,
      theme,
      accent,
      font,
      grid,
      sort,
    });
    if (result.data) router.push(`/admin/galleries/${result.data.id}`);
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        <SettingsCard id="details" title="Details">
          <FormField label="Gallery name" error={errorFor('title')}>
            {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required autoComplete="off" />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Shoot date" error={errorFor('shootDate')}>
              {(ids) => <Input {...ids} type="date" value={shootDate} onChange={(e) => setShootDate(e.target.value)} />}
            </FormField>
            <FormField label="Client name" error={errorFor('clientName')}>
              {(ids) => <Input {...ids} value={clientName} onChange={(e) => setClientName(e.target.value)} maxLength={80} autoComplete="off" />}
            </FormField>
          </div>
          <FormField label="Client email" hint="Used when you email the gallery link." error={errorFor('clientEmail')}>
            {(ids) => <Input {...ids} type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} autoComplete="off" />}
          </FormField>
          <FormField
            label="Gallery address"
            hint={
              <>
                <Mono size="caption">/g/{readable}</Mono>
                <Mono size="caption" className="text-ink-faint">
                  -{'x'.repeat(SUFFIX_LENGTH)}
                </Mono>{' '}
                — the random part is added when the gallery is created, so the link can’t be guessed.
              </>
            }
            error={errorFor('slugBase')}
          >
            {(ids) => (
              <Input
                {...ids}
                value={readable}
                onChange={(e) => setSlugBase(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || null)}
                autoComplete="off"
              />
            )}
          </FormField>
        </SettingsCard>

        <SettingsCard id="purpose" title="Purpose" description="This choice sets the image sizes and watermark for this gallery’s uploads.">
          <RadioCards name="purpose" value={purpose} options={PURPOSES} onChange={choosePurpose} aria-label="Purpose" />
          <details className="font-sans text-body-sm text-ink-2">
            <summary className="cursor-pointer font-semibold text-ink coarse:py-[13px]">Advanced: preview size</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <FormField label="Long edge (px)" error={errorFor('display')}>
                {(ids) => (
                  <Input
                    {...ids}
                    type="number"
                    min={400}
                    max={4096}
                    value={display[purpose].longEdge}
                    onChange={(e) => setDisplay({ ...display, [purpose]: { ...display[purpose], longEdge: Number(e.target.value) } })}
                  />
                )}
              </FormField>
              <FormField label="Quality (40–95)">
                {(ids) => (
                  <Input
                    {...ids}
                    type="number"
                    min={40}
                    max={95}
                    value={display[purpose].quality}
                    onChange={(e) => setDisplay({ ...display, [purpose]: { ...display[purpose], quality: Number(e.target.value) } })}
                  />
                )}
              </FormField>
            </div>
          </details>
        </SettingsCard>

        <SettingsCard id="access" title="Who can open it">
          <Segmented options={ACCESS} value={access} onValueChange={setAccess} aria-label="Who can open it" />
          {access === 'password' ? (
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Password" hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters. Your client types it once per device.`} error={errorFor('password')} className="min-w-0 flex-1">
                {(ids) => <Input {...ids} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} />}
              </FormField>
              <Button type="button" variant="secondary" onClick={() => setPassword(generateGalleryPassword())}>
                Generate
              </Button>
            </div>
          ) : (
            <Caption>The link contains a random part; anyone you send it to can open the gallery.</Caption>
          )}
        </SettingsCard>

        <SettingsCard id="look" title="Look">
          <Segmented options={THEMES} value={theme} onValueChange={setTheme} aria-label="Theme" />
          <SwatchPicker name="accent" value={accent} swatches={SWATCHES} onChange={setAccent} theme={theme === 'dark' ? 'dark' : 'light'} aria-label="Accent colour" />
          <FormField label="Typography">
            {(ids) => (
              <Select {...ids} value={font} onChange={(e) => setFont(e.target.value)}>
                {PAIRINGS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.scripts.includes('cyrillic') ? '' : ' (Latin only)'}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <Segmented options={GRIDS} value={grid} onValueChange={setGrid} aria-label="Grid style" />
        </SettingsCard>

        <SettingsCard id="order" title="Order" description="Lightroom exports are numbered in shooting order, so filename usually works best.">
          <Segmented options={SORTS} value={sort} onValueChange={setSort} aria-label="Photo order" />
        </SettingsCard>

        <SettingsCard id="watermark" title="Watermark">
          <Toggle
            checked={watermarkOn}
            onCheckedChange={setWatermarkOn}
            disabled={!hasWatermark}
            label="Watermark the previews"
            description={hasWatermark ? `${watermark.label} — baked into the previews when you upload. Changing it later means a new gallery.` : 'Set up a watermark in Settings → Watermarks first.'}
          />
        </SettingsCard>

        <FormNote message={!field ? message : null} />
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={loading || !title.trim()}>
            {loading ? 'Creating…' : 'Create gallery'}
          </Button>
        </div>
      </div>

      <aside aria-label="Cover preview" className="order-first lg:sticky lg:top-6 lg:order-none">
        <div
          data-gallery-root
          data-gallery-theme={theme}
          data-gallery-accent={accent}
          data-gallery-font={font}
          className={`${GALLERY_FONT_CLASSES} flex aspect-[4/5] flex-col justify-end gap-2 rounded-card bg-wash p-6 text-ink`}
        >
          <Text size="caption" tone="muted">
            {shootDate || 'Shoot date'}
          </Text>
          <Display size="md" as="p">
            {title || 'Gallery name'}
          </Display>
          <span className="inline-flex w-fit rounded-button bg-accent px-3 py-1.5 text-body-sm font-semibold text-inverse">View gallery</span>
        </div>
      </aside>
    </form>
  );
}
