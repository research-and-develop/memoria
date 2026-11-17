'use client';

import { twMerge } from './cn';

export type Swatch<T extends string> = { id: T; label: string };

/**
 * Pick a gallery accent (theme/gallery.mjs → SWATCHES). Native radio inputs, so the browser moves
 * and selects with the arrow keys in reading order and Tab reaches the group once. Each circle is
 * painted by the real gallery attributes (`data-gallery-theme` + `data-gallery-accent` on the same
 * element: that is what an accent rule matches), never an inline colour, so it shows the accent as
 * the gallery will (`theme`: light by default). 44 px targets, the label under each; the grid wraps
 * (twelve swatches: three rows at 360 px, two from `sm`).
 */
export function SwatchPicker<T extends string>({
  name,
  value,
  swatches,
  onChange,
  theme = 'light',
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  name: string;
  value: T;
  swatches: readonly Swatch<T>[];
  onChange: (value: T) => void;
  theme?: 'light' | 'dark';
  disabled?: boolean;
  className?: string;
  'aria-label': string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={twMerge('grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6', className)}>
      {swatches.map((swatch) => (
        <label key={swatch.id} className={twMerge('group flex min-h-11 cursor-pointer flex-col items-center gap-1.5 font-sans', disabled && 'cursor-not-allowed opacity-50')}>
          <input
            type="radio"
            name={name}
            value={swatch.id}
            checked={swatch.id === value}
            disabled={disabled}
            onChange={() => onChange(swatch.id)}
            className="peer sr-only"
          />
          {/* The ring stays in the page's scope; only the inner circle takes the gallery's colours. */}
          <span
            aria-hidden
            className="rounded-full p-0.5 transition-shadow peer-checked:ring-2 peer-checked:ring-focus peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus motion-reduce:transition-none"
          >
            <span data-gallery-theme={theme} data-gallery-accent={swatch.id} className="block size-10 rounded-full bg-accent" />
          </span>
          <span className="text-caption text-ink-2 peer-checked:font-semibold peer-checked:text-ink">{swatch.label}</span>
        </label>
      ))}
    </div>
  );
}
