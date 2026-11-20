import type { Options } from '@repo/db/client';
import type { MailAddress } from '@repo/platform/ports';

/**
 * Email templates (plan p03, D3.8): pure functions from parameters and the studio's context to a
 * subject, a plain-text and an HTML body. Rendered by the relay when sending, and by the app for a
 * preview (Phase 5) with no mailer.
 */
export type EmailContext = {
  studioName: string;
  /** The studio's website address (an origin), or null when none is known. */
  siteUrl: string | null;
  /** The website address + `path` (starting with `/`). Throws SITE_URL_MISSING when there is none. */
  link(path: string): string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

/** What a template's `load` may use: the database options and the resolved recipient. */
export type EmailLoadContext = { opts?: Options; to: MailAddress };

/**
 * One template. `parse` checks the stored parameters (a job's `params`): null when they are not
 * this template's. Parameters never hold a secret or a code (D3.19); a name a visitor typed never
 * reaches a subject (D3.15). The optional `load` (plan p05, D5.20) runs at send time, after `parse`
 * and before `render`: it reads what the email needs (a gallery, its password) so the stored
 * parameters stay ids; `render` then takes what `load` returned. Without `load`, `render` takes the
 * parsed parameters.
 */
export type EmailTemplate<P, R = P> = {
  id: string;
  /** What Settings → Emails calls it ("Test email"). */
  label: string;
  parse(params: unknown): P | null;
  load?(params: P, ctx: EmailLoadContext): Promise<R>;
  render(value: R, ctx: EmailContext): RenderedEmail;
};

/** Any template, for the registry: `render` is only ever given what its own `parse` (and `load`) made. */
export type AnyEmailTemplate = EmailTemplate<unknown, unknown>;
