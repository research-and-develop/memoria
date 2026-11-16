import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { noStore, signInError } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor } from '@/lib/auth/confirm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { saveMailSettings } from '@/lib/email/admin';
import { readMailSettings } from '@/lib/settings/mail';
import { parseMailSettingsInput, toMailSettingsView } from '@/lib/settings/parseMailSettings';
import { settingsCipher } from '@/lib/settings/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Settings → Emails → Sending (plan p03, D3.17, D3.18): the provider, its credentials, the From
 * address and name, the reply-to. Needs a code (whoever controls the mail settings can read or
 * redirect the studio's email); the secret is sealed and never sent back. The notice that the
 * settings changed goes out through the previous ones.
 */
export const PUT = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const key = getPlatform().config().settingsKey;
    if (!key) return signInError(503, 'SETTINGS_KEY_MISSING', 'The server has no SETTINGS_ENCRYPTION_KEY yet: the person who installed Memoria must set it.');

    const previous = await readMailSettings();
    const parsed = parseMailSettingsInput(await req.json().catch(() => ({})), previous);
    if (!parsed.ok) {
      return noStore(parsed.errorCode ? signInError(400, parsed.errorCode, parsed.message, { field: parsed.field }) : invalidParamsError(parsed.message, parsed.field));
    }
    const confirm = requireRecentSecondFactor(admin.ctx);
    if (confirm) return confirm;

    const saved = await saveMailSettings({ value: parsed.value, secret: parsed.secret, previous, cipher: await settingsCipher(key), now: new Date() });
    logger.info({ event: 'mail_settings_changed', provider: saved.provider, secretChanged: parsed.secret !== null, session: admin.ctx.sessionId.slice(0, 12) });
    return noStore(NextResponse.json({ data: toMailSettingsView(saved) }));
  },
  { route: 'PUT /api/admin/settings/mail' },
);
