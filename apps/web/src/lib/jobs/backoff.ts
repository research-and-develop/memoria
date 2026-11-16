/** A provider's `Retry-After` is honoured up to this (a bigger one would park a job for hours). */
export const MAX_RETRY_AFTER_SECONDS = 60 * 60;

/**
 * When the next attempt is due after attempt number `attempt` failed (plan p03 → The runner):
 * the schedule's step for that attempt (minutes; the last step repeats), or the provider's
 * `Retry-After` when that is longer, capped at an hour. Pure.
 */
export function nextRunAfter(attempt: number, now: Date, schedule: readonly number[], retryAfterSeconds?: number): Date {
  const step = schedule[Math.min(Math.max(attempt, 1), schedule.length) - 1] ?? 1;
  const stepMs = step * 60_000;
  const retryMs = retryAfterSeconds && retryAfterSeconds > 0 ? Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS) * 1000 : 0;
  return new Date(now.getTime() + Math.max(stepMs, retryMs));
}
