'use client';

import * as React from 'react';
import { twMerge } from './cn';

export type RadioCardOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** A line under the label (read with the option: `aria-describedby`). */
  description?: React.ReactNode;
  /** A small picture beside the text (a grid diagram, a font sample). Decorative. */
  preview?: React.ReactNode;
  disabled?: boolean;
};

/**
 * Pick one of a few options that each need a sentence (Selection / Sharing, Sans / Serif). Native
 * radio inputs inside labels, so the browser moves and selects with the arrow keys and Tab reaches
 * the group once; each radio is named by its label and described by its description. The selected
 * card is ringed with the focus colour; each card is at least 44 px tall. Controlled: the parent
 * owns `value`. Colours are theme roles.
 */
export function RadioCards<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: {
  name: string;
  value: T;
  options: readonly RadioCardOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const id = React.useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} className={twMerge('grid gap-2 sm:grid-cols-2', className)}>
      {options.map((option, index) => {
        const labelId = `${id}-${index}-label`;
        const descriptionId = option.description ? `${id}-${index}-description` : undefined;
        const optionDisabled = disabled || option.disabled === true;
        return (
          <label
            key={option.value}
            className={twMerge(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-line-control bg-surface p-3 font-sans transition-colors hover:bg-wash motion-reduce:transition-none',
              'has-[:checked]:border-focus has-[:checked]:ring-1 has-[:checked]:ring-focus',
              'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              optionDisabled && 'cursor-not-allowed opacity-50 hover:bg-surface',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={optionDisabled}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-4 shrink-0 accent-accent"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span id={labelId} className="text-body font-semibold text-ink">
                {option.label}
              </span>
              {option.description ? (
                <span id={descriptionId} className="text-body-sm text-ink-muted">
                  {option.description}
                </span>
              ) : null}
            </span>
            {option.preview ? (
              <span aria-hidden className="shrink-0">
                {option.preview}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
