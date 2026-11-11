'use client';

import { twMerge } from './cn';
import {
  format as dfFormat,
  formatDistanceToNow as dfFormatDistanceToNow,
  isValid as dfIsValid,
  parseISO as dfParseISO,
} from 'date-fns';

/**
 * The house date formatter. Render every date through `formatDate` / `DateText`:
 * date-fns patterns never follow the host locale, so a workstation in one locale and
 * an American browser read the same date the same way. Never
 * `toLocaleDateString(undefined, …)`, never hand-slice an ISO string.
 * Guard: scripts/guards/no-host-locale-date.test.ts.
 */

export type FormatDateOptions = {
  /** date-fns pattern, e.g. 'dd MMM yyyy'. Default 'dd.MM.yyyy' (+ ' HH:mm:ss' with showTime). */
  pattern?: string;
  showTime?: boolean;
  /** Relative: "3 minutes ago". */
  fromNow?: boolean;
  /** Text when the value is empty or invalid. */
  fallback?: string | null;
};

export function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null || input === '') return null;
  if (input instanceof Date) return dfIsValid(input) ? input : null;
  if (typeof input === 'number') {
    const d = new Date(input);
    return dfIsValid(d) ? d : null;
  }
  const iso = dfParseISO(input);
  if (dfIsValid(iso)) return iso;
  const d = new Date(input);
  return dfIsValid(d) ? d : null;
}

export function formatDate(value: string | number | Date | null | undefined, options: FormatDateOptions = {}): string | null {
  const d = toDate(value);
  if (!d) return options.fallback ?? null;
  if (options.fromNow) return dfFormatDistanceToNow(d, { addSuffix: true });
  const pattern = options.pattern ?? (options.showTime ? 'dd.MM.yyyy HH:mm:ss' : 'dd.MM.yyyy');
  return dfFormat(d, pattern);
}

export type DateTextProps = FormatDateOptions & {
  value: string | number | Date | null | undefined;
  className?: string;
  /** Hover title: the full timestamp. */
  withTitle?: boolean;
};

export function DateText({ value, className, withTitle, pattern, showTime, fromNow, fallback }: DateTextProps) {
  const text = formatDate(value, { pattern, showTime, fromNow, fallback });
  return (
    <span
      className={twMerge('tabular-nums', className)}
      title={withTitle ? (formatDate(value, { showTime: true }) ?? undefined) : undefined}
    >
      {text ?? fallback ?? '—'}
    </span>
  );
}
