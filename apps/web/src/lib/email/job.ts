import { logger } from '@repo/logger';
import { parseEmailAddress } from '@repo/platform/mail/address';
import { MailError } from '@repo/platform/mail/error';
import { isHeaderSafe } from '@repo/platform/mail/mime';
import type { MailAddress } from '@repo/platform/ports';

import { readAdminAccount } from '@/lib/auth/account';
import { jobStatement } from '@/lib/jobs/enqueue';
import { JobError, type JobKind } from '@/lib/jobs/types';
import { envMailProblem, readMailSetup } from '@/lib/settings/mail';
import { readStudio } from '@/lib/settings/studio';

import { emailContext } from './context';
import { emailTemplate } from './templates/registry';

/**
 * Who gets the email: an address fixed when it was queued, or the sign-in account's email, looked
 * up when sending (security notices, D3.19: the account may change while the job waits).
 */
export type EmailRecipient = { email: string; name?: string } | { account: true };

export type EmailPayload = { template: string; to: EmailRecipient; params: unknown };

/** Email: 6 attempts, after 1, 5, 30, 120 and 480 minutes (D3.9). The test email gets 1. */
export const EMAIL_MAX_ATTEMPTS = 6;

/**
 * The `email` job (plan p03, D3.8): rendered and sent by the relay when it runs, with the studio's
 * name and address and the mail settings as they are then. The job id is the Message-ID, the same
 * across retries. On done, the runner drops `params` (they may name people) and keeps the
 * provider's message id.
 */
export const emailJob: JobKind<EmailPayload> = {
  kind: 'email',
  version: 1,
  maxAttempts: EMAIL_MAX_ATTEMPTS,
  priority: 0,
  backoff: [1, 5, 30, 120, 480],
  parse(payload) {
    const { template: id, to, params } = payload;
    if (typeof id !== 'string') return { ok: false, unknown: false };
    const template = emailTemplate(id);
    // A template this code does not know yet (written by a newer app): wait for the deploy.
    if (!template) return { ok: false, unknown: true };
    const recipient = parseRecipient(to);
    const parsed = template.parse(params);
    if (!recipient || parsed === null) return { ok: false, unknown: false };
    return { ok: true, value: { template: id, to: recipient, params: parsed } };
  },
  async run(payload, ctx) {
    const setup = await readMailSetup();
    if (!setup) throw new MailError('MAIL_NOT_CONFIGURED', { configuration: true, detail: envMailProblem() ?? undefined });
    const studio = await readStudio();
    const to = await resolveRecipient(payload.to);
    const template = emailTemplate(payload.template);
    if (!template) throw new JobError('UNKNOWN_TEMPLATE');
    const rendered = template.render(payload.params, emailContext(studio));
    if (setup.transport.provider === 'smtp' && setup.transport.smtp.security === 'none') {
      logger.warn({ event: 'mail_insecure_dev', jobId: ctx.jobId });
    }
    const result = await ctx.mailerFor(setup.transport).send(
      {
        id: ctx.jobId,
        from: { email: setup.from.email, name: setup.from.name ?? studio.name },
        to,
        ...(setup.replyTo ? { replyTo: setup.replyTo } : {}),
        ...rendered,
      },
      { signal: ctx.signal },
    );
    return { providerMessageId: result.providerMessageId };
  },
};

function parseRecipient(value: unknown): EmailRecipient | null {
  if (typeof value !== 'object' || value === null) return null;
  const to = value as Record<string, unknown>;
  if (to.account === true) return { account: true };
  const email = parseEmailAddress(to.email);
  if (!email) return null;
  if (to.name === undefined) return { email };
  return typeof to.name === 'string' && to.name.length <= 100 && isHeaderSafe(to.name) ? { email, name: to.name } : null;
}

async function resolveRecipient(to: EmailRecipient): Promise<MailAddress> {
  if (!('account' in to)) return to;
  const account = await readAdminAccount();
  // No account yet: nothing to tell anyone; retrying cannot help.
  if (!account) throw new JobError('ACCOUNT_MISSING', { permanent: true });
  return { email: account.email };
}

/**
 * An email as a statement for the caller's batch (AGENTS.md → Data rules), then `nudgeRelay()`.
 * Throws on a template or parameters that do not parse (a programming error).
 */
export function emailJobStatement(input: { template: string; to: EmailRecipient; params: unknown; now: Date; maxAttempts?: number; ref?: string; id?: string }) {
  return jobStatement(emailJob, { template: input.template, to: input.to, params: input.params }, { now: input.now, maxAttempts: input.maxAttempts, ref: input.ref, id: input.id });
}
