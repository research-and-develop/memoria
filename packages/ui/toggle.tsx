import * as React from 'react';
import { twMerge } from './cn';

/**
 * An on/off switch with its visible label (and an optional description) in a row at least 44 px
 * tall. A real `<button role="switch">`: Space and Enter work natively, and clicking the label
 * toggles it (a button is labelable). Controlled: the parent owns `checked`. Colours are theme
 * roles (theme/studio.mjs): `accent` when on, `line-input` when off.
 */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  id,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const autoId = React.useId();
  const switchId = id ?? autoId;
  const descriptionId = description ? `${switchId}-description` : undefined;
  return (
    <div className={twMerge('flex min-h-11 items-center justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={switchId} className={twMerge('font-sans text-body-sm font-semibold text-ink', disabled ? 'text-ink-faint' : 'cursor-pointer')}>
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="font-sans text-caption text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={twMerge(
          'relative inline-flex h-[26px] w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
          checked ? 'bg-accent' : 'bg-line-input',
        )}
      >
        <span
          aria-hidden
          className={twMerge(
            'h-[22px] w-[22px] rounded-full bg-surface shadow-control transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
