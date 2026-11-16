import { housekeepingJob } from './housekeeping';
import type { AnyJobKind } from './types';

/**
 * Every job kind the relay can run (plan p03). A kind is never removed while rows may still use
 * it: it stays as a handler that fails permanently with a reason for 30 days (D3.14). The relay
 * deploys before the app, so it knows a kind before the app enqueues one.
 */
export const JOB_KINDS: readonly AnyJobKind[] = [housekeepingJob];
