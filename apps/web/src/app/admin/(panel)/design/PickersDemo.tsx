'use client';

import { useState } from 'react';

import { RadioCards } from '@repo/ui/radioCards';
import { SwatchPicker } from '@repo/ui/swatchPicker';
import { DEFAULT_ACCENT, SWATCHES, type AccentId } from '@repo/ui/theme/gallery';
import { Mono, Text } from '@repo/ui/typography';

const PURPOSES = [
  { value: 'selection', label: 'Selection', description: 'Smaller watermarked previews; the client picks favourites. No full-size downloads.' },
  { value: 'sharing', label: 'Sharing', description: 'The final photos, full size, ready to download.' },
] as const;

/** The pickers Phase 5's New gallery and the Settings screens use: radio cards and the accent swatches. */
export function PickersDemo() {
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]['value']>('selection');
  const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);
  const [dark, setDark] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Text size="body-sm" weight="semibold" id="demo-purpose">
          Radio cards
        </Text>
        <RadioCards name="demo-purpose" aria-labelledby="demo-purpose" value={purpose} options={PURPOSES} onChange={setPurpose} />
        <Mono>purpose = {purpose}</Mono>
      </div>
      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <Text size="body-sm" weight="semibold">
            Swatch picker
          </Text>
          <label className="flex items-center gap-2 font-sans text-body-sm text-ink-2">
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} className="size-4 accent-accent" />
            As on a dark gallery
          </label>
        </span>
        <SwatchPicker name="demo-accent" aria-label="Accent" value={accent} swatches={SWATCHES} onChange={setAccent} theme={dark ? 'dark' : 'light'} className="max-w-xl" />
        <Mono>accent = {accent}</Mono>
      </div>
    </div>
  );
}
