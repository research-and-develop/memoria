import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { noStore } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor } from '@/lib/auth/confirm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { parseStudioInput, type Studio } from '@/lib/settings/parseStudioInput';
import { readStudio, saveStudio, withDefaults } from '@/lib/settings/studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Settings → Studio (plan p02b, D2b.9): the studio name and the website
 * address. A new website address needs a code (it goes into the links of
 * client emails, so a stolen session alone must not redirect them); a new
 * name does not. Answers the settings as they now take effect.
 */
export const PATCH = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { isDevelopment } = getPlatform().config();
    const parsed = parseStudioInput(await req.json().catch(() => ({})), { isDevelopment });
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));

    const before = await readStudio();
    const after = withDefaults(parsed.value);
    const fields = (['name', 'siteUrl'] as const).filter((field) => before[field] !== after[field]);
    if (fields.includes('siteUrl')) {
      const confirm = requireRecentSecondFactor(admin.ctx);
      if (confirm) return confirm;
    }
    if (fields.length > 0) {
      await saveStudio(parsed.value, fields);
      logger.info({ event: 'studio_settings_changed', fields, session: admin.ctx.sessionId.slice(0, 12) });
    }
    return noStore(NextResponse.json({ data: after satisfies Studio }));
  },
  { route: 'PATCH /api/admin/settings/studio' },
);
