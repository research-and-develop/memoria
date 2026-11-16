import { dateTimeLabel } from '@/lib/dates';

import { renderLayout } from '../layout';
import type { EmailTemplate } from '../types';

/** The test email (Settings → Emails): proof that the chosen provider delivers. */
export const testTemplate: EmailTemplate<{ queuedAt: string }> = {
  id: 'test',
  label: 'Test email',
  parse(params) {
    if (typeof params !== 'object' || params === null) return null;
    const queuedAt = (params as { queuedAt?: unknown }).queuedAt;
    return typeof queuedAt === 'string' && !Number.isNaN(Date.parse(queuedAt)) ? { queuedAt } : null;
  },
  render({ queuedAt }, ctx) {
    return {
      subject: `Test email from ${ctx.studioName}`,
      ...renderLayout(ctx, {
        heading: 'Email works',
        paragraphs: [
          `This test was sent from Settings → Emails on ${dateTimeLabel(queuedAt)} (UTC).`,
          'Your clients will receive their emails the same way. There is no need to reply.',
        ],
      }),
    };
  },
};
