'use client';

import * as React from 'react';
import { twMerge } from './cn';

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode };

/**
 * A segmented control: pick one of a few options (Grid / List, Light / Dark / Auto). A radio group
 * with a roving tabindex: Tab reaches the selected option, the arrow keys move AND select, Home and
 * End jump to the ends. 40 px tall; on a touch screen each option's hit area grows to 44 px.
 * Controlled: the parent owns `value`. Colours are theme roles (theme/studio.mjs).
 */
export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  'aria-label': string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    onValueChange(option.value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const target = { ArrowRight: index === last ? 0 : index + 1, ArrowDown: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, ArrowUp: index === 0 ? last : index - 1, Home: 0, End: last }[
      event.key
    ];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined} className={twMerge('inline-flex rounded-control bg-wash p-1', className)}>
      {options.map((option, index) => {
        const isSelected = index === selected;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            disabled={disabled}
            onClick={() => select(index)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={twMerge(
              "relative h-8 rounded-md px-3 font-sans text-body-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none coarse:before:absolute coarse:before:inset-x-0 coarse:before:-inset-y-1.5 coarse:before:content-['']",
              isSelected ? 'bg-surface font-semibold text-ink shadow-control' : 'text-ink-2 hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
