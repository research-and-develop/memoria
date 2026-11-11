/**
 * Dates rendered on the SERVER (server components, emails, CSV). Pure, and
 * never in the host's locale or time zone: both are explicit, so a Worker in
 * any data centre and a test on any laptop print the same text. Client
 * components use `formatDate` / `<DateText>` from `@repo/ui/date` instead.
 * Guard: scripts/guards/no-host-locale-date.test.ts.
 *
 * Set these two for your audience.
 */
export const APP_LOCALE = 'en-GB';
export const APP_TIME_ZONE = 'UTC';

const dateTimeFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** `9 Nov 2026, 14:05` — or '' for a value that is not a date. */
export function dateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
}

/** Today's calendar date (YYYY-MM-DD) in the app's time zone. */
export function todayInAppZone(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; the time zone is explicit, never the host's.
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
