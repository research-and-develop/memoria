import * as React from 'react';
import { twMerge } from './cn';

/**
 * A selectable pill (plan p05 T5.9): set chips on a phone, filter chips. 40 px tall with a 1.5 px
 * border; on a touch screen its hit area grows to 44 px. Selected = an accent fill with `inverse`
 * text: in a client gallery `inverse` is only legible on an accent fill (AGENTS.md → Client code),
 * so the selected state never uses `ink`. Colours are theme roles (theme/studio.mjs).
 *
 * A toggle by default (`aria-pressed`); given `role="tab"` (as `Tabs variant="chip"` does) it reports
 * `aria-selected` instead.
 */
export type ChipProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  selected: boolean;
  children: React.ReactNode;
  /** A number after the label (a set's photo count). */
  count?: number;
};

export function chipClassName(selected: boolean, className?: string): string {
  return twMerge(
    "relative inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border-chip px-3.5 font-sans text-body font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none coarse:before:absolute coarse:before:inset-x-0 coarse:before:-inset-y-0.5 coarse:before:content-['']",
    selected ? 'border-accent bg-accent text-inverse' : 'border-line-control bg-surface text-ink hover:bg-wash',
    className,
  );
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip({ selected, count, className, children, type = 'button', ...props }, ref) {
  const isTab = props.role === 'tab';
  return (
    <button ref={ref} type={type} {...props} aria-pressed={isTab ? undefined : selected} aria-selected={isTab ? selected : undefined} className={chipClassName(selected, className)}>
      {children}
      {count !== undefined && <span className="font-normal tabular-nums">{count}</span>}
    </button>
  );
});
