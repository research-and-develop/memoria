import type { AnyEmailTemplate, EmailContext, RenderedEmail } from '../types';

import { SECURITY_TEMPLATES } from './security';
import { testTemplate } from './test';

/**
 * Every email template (plan p03, D3.8). The relay deploys before the app (D3.14), so it knows a
 * template before the app enqueues one; a template that no longer exists in this code (a rollback)
 * makes its job wait, not fail (runner → UNKNOWN_KIND). A template is never removed while jobs may
 * still use it. Pure: no `server-only`, so the app can render a preview (Phase 5).
 */
export const EMAIL_TEMPLATES: Readonly<Record<string, AnyEmailTemplate>> = Object.fromEntries(
  [testTemplate, ...SECURITY_TEMPLATES].map((t) => [t.id, t as AnyEmailTemplate]),
);

export function emailTemplate(id: string): AnyEmailTemplate | null {
  return Object.hasOwn(EMAIL_TEMPLATES, id) ? (EMAIL_TEMPLATES[id] ?? null) : null;
}

/** Render a template by id. Throws on an unknown id or parameters that are not the template's. */
export function renderEmail(id: string, params: unknown, ctx: EmailContext): RenderedEmail {
  const template = emailTemplate(id);
  if (!template) throw new Error(`renderEmail: no template ${id}`);
  const parsed = template.parse(params);
  if (parsed === null) throw new Error(`renderEmail: bad parameters for ${id}`);
  return template.render(parsed, ctx);
}

/** What Settings → Emails calls a template ("Test email"); the id itself when unknown. */
export function templateLabel(id: string): string {
  return emailTemplate(id)?.label ?? id;
}
