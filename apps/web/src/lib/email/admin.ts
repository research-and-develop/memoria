import 'server-only';

import { batch, type Options } from '@repo/db/client';
import { domainOf } from '@repo/platform/mail/address';

import { auditStatement, conditionalAuditStatement } from '@/lib/db/queries/audit_log';
import { getEmailJob, listRecentEmailJobs, oldestUnsentEmailDueAt, retryFailedEmailStatement, type JobRow } from '@/lib/db/queries/jobs';
import { upsertSiteSettingStatement } from '@/lib/db/queries/site_settings';
import { nudgeRelay } from '@/lib/jobs/enqueue';
import { MAIL_SETTING_KEY } from '@/lib/settings/mail';
import { MAIL_PROVIDER_LABELS, MAIL_SECRET_FIELD, type MailSettings } from '@/lib/settings/parseMailSettings';
import { mailSecretAad, type SettingsCipher } from '@/lib/settings/secrets';
import { SECURITY_NOTICES_KEY, securityNoticesStatement } from '@/lib/settings/securityNotices';

import { emailJobStatement } from './job';
import { securityNotices } from './notices';
import { templateLabel } from './templates/registry';
import { toEmailView, type EmailView } from './views';

/**
 * What Settings → Emails does (plan p03 → Settings → Emails), for its routes and its page. Every
 * change is one batch with its audit row (and its notice), then `nudgeRelay()` when a job was
 * written. Audit rows never hold an address or a secret.
 */

/** How the account recipient is shown in the list. */
export const ACCOUNT_LABEL = 'Your sign-in email';
export const RECENT_EMAILS = 20;
/** An email never tried after this long means the relay is not running. */
export const NOT_SENDING_AFTER_MS = 10 * 60 * 1000;

export const emailView = (job: JobRow): EmailView => toEmailView(job, { templateLabel: templateLabel(String(job.payload.template ?? '')), accountLabel: ACCOUNT_LABEL });

export async function recentEmails(opts?: Options): Promise<EmailView[]> {
  return (await listRecentEmailJobs(RECENT_EMAILS, opts)).map(emailView);
}

export async function findEmail(id: string, opts?: Options): Promise<EmailView | null> {
  const job = await getEmailJob(id, opts);
  return job ? emailView(job) : null;
}

/** True when an email has waited more than 10 minutes without a first try (the banner). */
export async function emailsNotSending(now: Date, opts?: Options): Promise<boolean> {
  return (await oldestUnsentEmailDueAt(new Date(now.getTime() - NOT_SENDING_AFTER_MS).toISOString(), opts)) !== null;
}

/** The test email: one attempt, audited without the address. Returns its job id. */
export async function queueTestEmail(to: string, now: Date, opts?: Options): Promise<string> {
  const job = emailJobStatement({ template: 'test', to: { email: to }, params: { queuedAt: now.toISOString() }, now, maxAttempts: 1 });
  await batch(
    [job.statement, auditStatement({ action: 'create', entity: 'email', entityId: job.id, summary: 'Sent a test email', details: { jobId: job.id, template: 'test' } })],
    opts,
  );
  nudgeRelay();
  return job.id;
}

/** Retry a failed email: 'retried', or why not ('not_found', 'not_failed'). */
export async function retryEmail(id: string, now: Date, opts?: Options): Promise<'retried' | 'not_found' | 'not_failed'> {
  const results = await batch(
    [
      retryFailedEmailStatement({ id, now: now.toISOString() }),
      conditionalAuditStatement({ action: 'update', entity: 'email', entityId: id, summary: 'Retried an email', details: { jobId: id } }, 'changes() > 0', []),
    ],
    opts,
  );
  if ((results[0]?.changes ?? 0) > 0) {
    nudgeRelay();
    return 'retried';
  }
  return (await getEmailJob(id, opts)) ? 'not_failed' : 'not_found';
}

/**
 * Save the mail settings (D3.17, D3.18): the secret sealed (or the saved one kept), the audit row
 * (provider only), and the notice that they changed, sent through the PREVIOUS settings.
 */
export async function saveMailSettings(
  input: { value: MailSettings; secret: string | null; previous: MailSettings | null; cipher: SettingsCipher; now: Date },
  opts?: Options,
): Promise<MailSettings> {
  const { value, previous, now } = input;
  const field = MAIL_SECRET_FIELD[value.provider];
  const sealed = input.secret !== null ? await input.cipher.encrypt(input.secret, mailSecretAad(value.provider, field)) : savedSecret(previous, value.provider);
  if (!sealed) throw new Error('saveMailSettings: no secret to keep');
  const settings: MailSettings = { ...value, [value.provider]: { ...(value[value.provider] as object), [field]: sealed } };
  const stored = JSON.stringify(settings);
  const notices = await securityNotices({ ...opts, mailConfigured: true });
  const notice = notices(
    'security.mail-settings-changed',
    { at: now.toISOString(), provider: MAIL_PROVIDER_LABELS[settings.provider], fromDomain: domainOf(settings.from.email) },
    { now, via: previous ?? undefined, when: { sql: `EXISTS (SELECT 1 FROM site_settings WHERE key = ? AND value = ?)`, params: [MAIL_SETTING_KEY, stored] } },
  );
  await batch(
    [
      upsertSiteSettingStatement(MAIL_SETTING_KEY, settings),
      auditStatement({
        action: 'update',
        entity: 'site_settings',
        entityId: MAIL_SETTING_KEY,
        summary: `Changed how email is sent (${MAIL_PROVIDER_LABELS[settings.provider]})`,
        details: { key: MAIL_SETTING_KEY, provider: settings.provider, secretChanged: input.secret !== null },
      }),
      ...(notice ? [notice] : []),
    ],
    opts,
  );
  if (notice) nudgeRelay();
  return settings;
}

function savedSecret(previous: MailSettings | null, provider: MailSettings['provider']): string | null {
  if (!previous || previous.provider !== provider) return null;
  const block = previous[provider] as Record<string, unknown> | undefined;
  const value = block?.[MAIL_SECRET_FIELD[provider]];
  return typeof value === 'string' ? value : null;
}

/** Turn security notices on or off (off: one last notice, in the same batch). */
export async function setSecurityNotices(enabled: boolean, now: Date, opts?: Options): Promise<void> {
  const notices = enabled ? () => null : await securityNotices(opts);
  const notice = notices(
    'security.notices-off',
    { at: now.toISOString() },
    { now, when: { sql: `EXISTS (SELECT 1 FROM site_settings WHERE key = ? AND json_extract(value, '$.enabled') = 0)`, params: [SECURITY_NOTICES_KEY] } },
  );
  await batch(
    [
      securityNoticesStatement(enabled),
      auditStatement({
        action: 'update',
        entity: 'site_settings',
        entityId: SECURITY_NOTICES_KEY,
        summary: enabled ? 'Turned security emails on' : 'Turned security emails off',
        details: { key: SECURITY_NOTICES_KEY, enabled },
      }),
      ...(notice ? [notice] : []),
    ],
    opts,
  );
  if (notice) nudgeRelay();
}
