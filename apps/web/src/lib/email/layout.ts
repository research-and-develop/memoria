import { tokenHex } from '@repo/ui/theme/tokens';

import type { EmailContext } from './types';

/**
 * The shell every email shares (plan p03, D3.8): an HTML version (a 600 px table, system fonts,
 * inline styles, the studio theme's colours through `tokenHex`, the studio name as a text header,
 * a footer) and the matching plain-text version. Every value is escaped here; templates pass plain
 * text. Pure.
 */
export type EmailBody = {
  heading: string;
  /** Plain text, one paragraph each. */
  paragraphs: readonly string[];
  /** A button; `href` comes from `ctx.link(path)` only. */
  action?: { label: string; href: string };
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderLayout(ctx: EmailContext, body: EmailBody): { text: string; html: string } {
  const c = {
    ground: tokenHex('ground'),
    surface: tokenHex('surface'),
    ink: tokenHex('ink'),
    ink2: tokenHex('ink-2'),
    muted: tokenHex('ink-muted'),
    line: tokenHex('line'),
    accent: tokenHex('accent'),
    inverse: tokenHex('inverse'),
  };
  const footer = ctx.siteUrl ? `${ctx.studioName} · ${ctx.siteUrl}` : ctx.studioName;
  const paragraphs = body.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${c.ink2};">${escapeHtml(p)}</p>`)
    .join('');
  const action = body.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td style="border-radius:8px;background:${c.accent};"><a href="${escapeHtml(body.action.href)}" style="display:inline-block;padding:12px 20px;font-size:16px;font-weight:600;color:${c.inverse};text-decoration:none;">${escapeHtml(body.action.label)}</a></td></tr></table>`
    : '';
  const html = [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(body.heading)}</title></head>`,
    `<body style="margin:0;padding:0;background:${c.ground};font-family:${FONT};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.ground};"><tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">`,
    `<tr><td style="padding:0 4px 16px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:${c.ink};">${escapeHtml(ctx.studioName)}</td></tr>`,
    `<tr><td style="background:${c.surface};border:1px solid ${c.line};border-radius:12px;padding:32px 28px;">`,
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:28px;font-weight:600;color:${c.ink};">${escapeHtml(body.heading)}</h1>`,
    paragraphs,
    action,
    '</td></tr>',
    `<tr><td style="padding:16px 4px 0;font-size:12px;line-height:18px;color:${c.muted};">${escapeHtml(footer)}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('\n');

  const text = [ctx.studioName, '', body.heading, '', ...body.paragraphs.flatMap((p) => [p, '']), ...(body.action ? [`${body.action.label}: ${body.action.href}`, ''] : []), '--', footer, ''].join('\n');
  return { text, html };
}
