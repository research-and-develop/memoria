'use client';

import { twMerge } from '@repo/ui/cn';

import { WATERMARK_ANCHORS, type WatermarkPosition } from '@/lib/settings/parseWatermarkInput';

const LABELS: Record<WatermarkPosition, string> = {
  'top-left': 'Top left',
  top: 'Top',
  'top-right': 'Top right',
  left: 'Left',
  center: 'Centre',
  right: 'Right',
  'bottom-left': 'Bottom left',
  bottom: 'Bottom',
  'bottom-right': 'Bottom right',
  tiled: 'Tiled',
};

/**
 * Where the watermark goes: a 3 × 3 grid of anchors plus *Tiled*. One group of native radios, so the
 * arrow keys move through all ten in reading order. 44 px cells.
 */
export function AnchorPicker({ value, onChange, labelledBy }: { value: WatermarkPosition; onChange: (value: WatermarkPosition) => void; labelledBy: string }) {
  const cell = (position: WatermarkPosition, className?: string) => (
    <label key={position} className={twMerge('group relative flex size-11 cursor-pointer items-center justify-center rounded-control', className)}>
      <input type="radio" name="watermark-position" value={position} checked={value === position} onChange={() => onChange(position)} className="peer sr-only" />
      <span className="sr-only">{LABELS[position]}</span>
      <span
        aria-hidden
        className="size-3 rounded-full bg-line-input transition-colors group-hover:bg-ink-muted peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-focus motion-reduce:transition-none"
      />
    </label>
  );
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap items-center gap-4">
      <div className="grid grid-cols-3 rounded-card border border-line-control bg-wash">{WATERMARK_ANCHORS.map((p) => cell(p))}</div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 font-sans text-body text-ink">
        <input type="radio" name="watermark-position" value="tiled" checked={value === 'tiled'} onChange={() => onChange('tiled')} className="size-4 accent-accent" />
        {LABELS.tiled}
      </label>
    </div>
  );
}

export function positionLabel(position: WatermarkPosition): string {
  return LABELS[position];
}
