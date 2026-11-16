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

/**
 * One template. `parse` checks the stored parameters (a job's `params`): null when they are not
 * this template's. Parameters never hold a secret or a code (D3.19); a name a visitor typed never
 * reaches a subject (D3.15).
 */
export type EmailTemplate<P> = {
  id: string;
  /** What Settings → Emails calls it ("Test email"). */
  label: string;
  parse(params: unknown): P | null;
  render(params: P, ctx: EmailContext): RenderedEmail;
};

/** Any template, for the registry: `render` is only ever given what its own `parse` made. */
export type AnyEmailTemplate = EmailTemplate<unknown>;
