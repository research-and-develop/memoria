'use client';

import * as React from 'react';
import { Chip } from './chip';
import { twMerge } from './cn';

/**
 * Tabs (plan p05 T5.9): the manager's sections, a gallery's sets. A WAI-ARIA tablist with a roving
 * tabindex: Tab reaches the selected tab, the arrow keys move (and, with automatic activation, select),
 * Home and End jump to the ends; disabled tabs are skipped. `activation="manual"` moves focus only and
 * selects on Enter or Space — for tabs whose panel costs a fetch.
 *
 * Two looks: `line` (44 px, an underline in the text colour under the selected tab, on a divider) and
 * `chip` (`Chip` pills that scroll sideways on a phone). Controlled: the parent owns `value`. The
 * panels are the caller's: `TabPanel` with the same `id` wires `aria-controls` / `aria-labelledby`.
 */
export type TabItem<T extends string> = { value: T; label: React.ReactNode; count?: number; disabled?: boolean };

const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
export const tabId = (id: string, value: string): string => `${id}-tab-${safe(value)}`;
export const tabPanelId = (id: string, value: string): string => `${id}-panel-${safe(value)}`;

export function Tabs<T extends string>({
  id,
  items,
  value,
  onValueChange,
  variant = 'line',
  activation = 'automatic',
  className,
  'aria-label': ariaLabel,
}: {
  /** Prefix of the tab and panel ids (unique on the page). */
  id: string;
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  variant?: 'line' | 'chip';
  activation?: 'automatic' | 'manual';
  className?: string;
  'aria-label': string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );

  const step = (from: number, delta: 1 | -1): number => {
    for (let i = 1; i <= items.length; i++) {
      const at = (from + delta * i + items.length) % items.length;
      if (!items[at]?.disabled) return at;
    }
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const first = step(-1, 1);
    const last = step(items.length, -1);
    const target = { ArrowRight: step(index, 1), ArrowLeft: step(index, -1), Home: first, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    refs.current[target]?.focus();
    const item = items[target];
    if (activation === 'automatic' && item) onValueChange(item.value);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={twMerge(variant === 'line' ? 'flex flex-wrap gap-1 border-b border-line' : 'flex gap-1.5 overflow-x-auto p-0.5', className)}
    >
      {items.map((item, index) => {
        const isSelected = index === selected;
        const common = {
          ref: (el: HTMLButtonElement | null) => {
            refs.current[index] = el;
          },
          id: tabId(id, item.value),
          role: 'tab' as const,
          'aria-controls': tabPanelId(id, item.value),
          tabIndex: isSelected ? 0 : -1,
          disabled: item.disabled,
          onClick: () => onValueChange(item.value),
          onKeyDown: (event: React.KeyboardEvent) => onKeyDown(event, index),
        };
        if (variant === 'chip') {
          return (
            <Chip key={item.value} {...common} selected={isSelected} count={item.count}>
              {item.label}
            </Chip>
          );
        }
        return (
          <button
            key={item.value}
            type="button"
            {...common}
            aria-selected={isSelected}
            className={twMerge(
              'relative inline-flex min-h-11 items-center gap-1.5 px-3.5 font-sans text-body font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus disabled:cursor-not-allowed disabled:text-ink-faint motion-reduce:transition-none',
              isSelected ? 'text-ink shadow-tab' : 'text-ink-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="text-micro font-normal tabular-nums text-ink-muted">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A panel of `Tabs` with the same `id`; hidden unless its tab is selected. */
export function TabPanel({ id, value, selected, className, children }: { id: string; value: string; selected: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={tabPanelId(id, value)} aria-labelledby={tabId(id, value)} hidden={!selected} tabIndex={0} className={twMerge('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', className)}>
      {selected ? children : null}
    </div>
  );
}
