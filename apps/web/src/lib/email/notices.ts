import 'server-only';

import type { Options, Statement } from '@repo/db/client';

import type { JobCondition } from '@/lib/jobs/enqueue';
import { isMailConfigured } from '@/lib/settings/mail';
import type { MailSettings } from '@/lib/settings/parseMailSettings';
import { readSecurityNoticesEnabled } from '@/lib/settings/securityNotices';

import { emailJobStatement, type EmailRecipient } from './job';
import type { SECURITY_TEMPLATES } from './templates/security';

export type SecurityTemplateId = (typeof SECURITY_TEMPLATES)[number]['id'];

export type NoticeOptions = {
  now: Date;
  /** The event happened: `changes() > 0` right after its statement, or an `EXISTS (…)`. */
  when: JobCondition;
  /** Default the account's email, looked up when sending. */
  to?: EmailRecipient;
  /** Send through these settings instead of the current ones (D3.18). */
  via?: MailSettings;
};

/** Builds one notice's job statement, or null when notices are off or email is not set up. */
export type NoticeBuilder = (template: SecurityTemplateId, params: Record<string, unknown>, opts: NoticeOptions) => Statement | null;

/**
 * Security notices (plan p03, D3.19): read once per request whether they go out (the switch is on
 * and email is configured), then build each as an `email` job for the event's own batch, written
 * only if the event happened. After the batch, `nudgeRelay()`.
 *
 *   const notices = await securityNotices();
 *   const notice = notices('security.password-changed', { at }, { now, when: { sql: 'EXISTS (…)', params } });
 *   await batch([...change, ...(notice ? [notice] : [])]);
 *   if (notice) nudgeRelay();
 *
 * Place it after every statement whose `results[n]` the caller reads; a `changes() > 0` condition
 * goes right after the statement it is about.
 */
export async function securityNotices(opts?: Options & { mailConfigured?: boolean }): Promise<NoticeBuilder> {
  // `mailConfigured`: the caller knows (the mail settings route is saving some right now).
  const [enabled, configured] = await Promise.all([readSecurityNoticesEnabled(opts), opts?.mailConfigured ?? isMailConfigured(opts)]);
  if (!enabled || !configured) return () => null;
  return (template, params, notice) =>
    emailJobStatement({ template, params, to: notice.to ?? { account: true }, now: notice.now, when: notice.when, ...(notice.via ? { via: notice.via } : {}) }).statement;
}
