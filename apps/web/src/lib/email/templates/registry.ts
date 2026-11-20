import type { AnyEmailTemplate, EmailContext, EmailLoadContext, RenderedEmail } from '../types';

import { galleryReadyTemplate } from './galleryReady';

import { SECURITY_TEMPLATES } from './security';
import { testTemplate } from './test';

/**
 * Every email template (plan p03, D3.8). The relay deploys before the app (D3.14), so it knows a
 * template before the app enqueues one; a template that no longer exists in this code (a rollback)
 * makes its job wait, not fail (runner → UNKNOWN_KIND). A template is never removed while jobs may
 * still use it. No `server-only`, so the app can render a preview (Phase 5); a template's `load` reads D1 (relay-safe).
 */
export const EMAIL_TEMPLATES: Readonly<Record<string, AnyEmailTemplate>> = Object.fromEntries(
  [testTemplate, ...SECURITY_TEMPLATES, galleryReadyTemplate].map((t) => [t.id, t as AnyEmailTemplate]),
);

export function emailTemplate(id: string): AnyEmailTemplate | null {
  return Object.hasOwn(EMAIL_TEMPLATES, id) ? (EMAIL_TEMPLATES[id] ?? null) : null;
}

function parsedTemplate(id: string, params: unknown): { template: AnyEmailTemplate; parsed: unknown } {
  const template = emailTemplate(id);
  if (!template) throw new Error(`renderEmail: no template ${id}`);
  const parsed = template.parse(params);
  if (parsed === null) throw new Error(`renderEmail: bad parameters for ${id}`);
  return { template, parsed };
}

/**
 * Render a template that has no `load` step by id. Throws on an unknown id, parameters that are not
 * the template's, or a template with a `load` step (use `loadAndRenderEmail`).
 */
export function renderEmail(id: string, params: unknown, ctx: EmailContext): RenderedEmail {
  const { template, parsed } = parsedTemplate(id, params);
  if (template.load) throw new Error(`renderEmail: ${id} has a load step`);
  return template.render(parsed, ctx);
}

/** What the relay does before sending, without sending (a preview, D5.20): parse → load → render. */
export async function loadAndRenderEmail(id: string, params: unknown, ctx: EmailContext, load: EmailLoadContext): Promise<RenderedEmail> {
  const { template, parsed } = parsedTemplate(id, params);
  const value = template.load ? await template.load(parsed, load) : parsed;
  return template.render(value, ctx);
}

/** What Settings → Emails calls a template ("Test email"); the id itself when unknown. */
export function templateLabel(id: string): string {
  return emailTemplate(id)?.label ?? id;
}
