'use client';

import { useState } from 'react';

import { Button } from '@repo/ui/button';
import { Segmented } from '@repo/ui/segmented';
import { Toggle } from '@repo/ui/toggle';
import { Mono } from '@repo/ui/typography';

const VIEWS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
] as const;
const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
] as const;

/** The interactive controls, live: toggles, segmented controls, a button that loads for a moment. */
export function ControlsDemo() {
  const [watermark, setWatermark] = useState(true);
  const [downloads, setDownloads] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]['value']>('grid');
  const [theme, setTheme] = useState<(typeof THEMES)[number]['value']>('auto');
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-md flex-col divide-y divide-line">
        <Toggle checked={watermark} onCheckedChange={setWatermark} label="Watermark previews" description="Baked into every preview at upload." />
        <Toggle checked={downloads} onCheckedChange={setDownloads} label="Allow downloads" />
        <Toggle checked={false} onCheckedChange={() => undefined} label="Disabled toggle" disabled />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Segmented aria-label="View" options={VIEWS} value={view} onValueChange={setView} />
        <Segmented aria-label="Gallery theme" options={THEMES} value={theme} onValueChange={setTheme} />
        <Mono>
          {view} · {theme}
        </Mono>
      </div>
      <div>
        <Button
          loading={saving}
          onClick={() => {
            setSaving(true);
            setTimeout(() => setSaving(false), 1500);
          }}
        >
          {saving ? 'Saving' : 'Click to load'}
        </Button>
      </div>
    </div>
  );
}
