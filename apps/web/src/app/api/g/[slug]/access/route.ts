import { NextResponse, type NextRequest } from 'next/server';

import { forbiddenError, invalidParamsError, jsonError, notFoundError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { AppError } from '@repo/core/error';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { getGalleryBySlug, getGalleryPasswordSealed } from '@/lib/db/queries/galleries';
import { ACCESS_TTL_SECONDS, accessCookieName, setCookieHeader, signAccessCookie } from '@/lib/edge/gallery/access';
import { galleryKeysFor } from '@/lib/edge/gallery/config';
import { GATE_IP_RULE, gateFailureRule, passwordsMatch, recordGateFailure } from '@/lib/galleries/gate';
import { parseGateInput } from '@/lib/galleries/parseGateInput';
import { openGalleryPassword } from '@/lib/galleries/password';
import { isSlug } from '@/lib/galleries/slug';
import { hitRateLimits, ipKey, isOverLimit } from '@/lib/security/rateLimit';
import { clientIp, isSameOrigin, isSecureRequest } from '@/lib/security/request';
import { settingsCipher } from '@/lib/settings/secrets';
import { verifyTurnstile } from '@/lib/turnstile/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const TOO_MANY = 'Too many tries. Try again in a few minutes.';

const noStore = <T extends Response>(res: T): T => {
  res.headers.set('Cache-Control', 'no-store');
  return res;
};

/**
 * The password gate (plan p06 D6.10): a public write, so in this order —
 * same-origin → the per-IP counter (counted before Turnstile, so junk costs no `siteverify`) → parse →
 * Turnstile → the gallery (published, password access; else 404) → the per-IP failure limit (checked,
 * not counted) → the comparison (HMAC both, constant time; the sealed password is opened HERE only,
 * never under `lib/edge/**`) → a wrong password is counted (and may queue the daily notice) → 401; the
 * right one sets `mg_<id>` for 30 days (`Path=/`), which `worker.ts` checks on every view.
 */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    if (!isSameOrigin(req)) return forbiddenError({ reason: 'cross_origin' });
    const platform = getPlatform();
    const config = platform.config();
    const ip = clientIp(req);
    const now = new Date();
    const key = await ipKey(ip, config.hashSalt, now);

    const counted = await hitRateLimits([GATE_IP_RULE(key)], { now });
    if (counted.limited) return noStore(tooManyRequestsError(counted.retryAfterSeconds, TOO_MANY));

    const { slug } = await params;
    if (!isSlug(slug)) return notFoundError();
    const parsed = parseGateInput(await req.json().catch(() => ({})));
    if (!parsed.ok) return invalidParamsError(parsed.message, parsed.field);

    const turnstile = await verifyTurnstile({
      token: parsed.value.turnstileToken,
      secret: config.turnstile.secretKey,
      action: 'gallery-gate',
      remoteIp: ip,
      hostname: new URL(req.url).hostname,
    });
    if (!turnstile.ok) {
      return jsonError(403, {
        error: 'Turnstile failed',
        errorCode: 'TURNSTILE_FAILED',
        details: { message: 'The security check failed. Please try again.', reason: turnstile.reason },
      });
    }

    const gallery = await getGalleryBySlug(slug);
    if (!gallery || gallery.status !== 'published' || gallery.access !== 'password') return notFoundError();
    const keys = await galleryKeysFor(config.settingsKey);
    if (!keys || !config.settingsKey) {
      logger.error({ event: 'gallery_key_missing' });
      throw new AppError('Gallery keys are not configured', 'GALLERY_UNAVAILABLE', { status: 503, message: 'The gallery is not available right now.' });
    }
    if (await isOverLimit(gateFailureRule(key, gallery.id), { now })) return noStore(tooManyRequestsError(15 * 60, TOO_MANY));

    const sealed = await getGalleryPasswordSealed(gallery.id);
    const stored = sealed ? await openGalleryPassword(await settingsCipher(config.settingsKey), gallery.id, sealed) : null;
    if (stored === null) {
      logger.error({ event: 'gallery_password_unreadable', galleryId: gallery.id });
      throw new AppError('Gallery password unreadable', 'GALLERY_UNAVAILABLE', { status: 503, message: 'The gallery is not available right now.' });
    }

    if (!(await passwordsMatch(keys.access, parsed.value.password, stored))) {
      await recordGateFailure({ ipKey: key, galleryId: gallery.id, passwordVersion: gallery.password_version, title: gallery.title, now });
      logger.info({ event: 'gallery_gate_failed', galleryId: gallery.id });
      return noStore(jsonError(401, { error: 'That password is not right.', errorCode: 'WRONG_PASSWORD' }));
    }

    const cookie = await signAccessCookie(keys.access, { galleryId: gallery.id, passwordVersion: gallery.password_version, now });
    const res = noStore(NextResponse.json({ data: { ok: true } }));
    res.headers.append(
      'Set-Cookie',
      setCookieHeader(accessCookieName(gallery.id), cookie, { maxAge: ACCESS_TTL_SECONDS, secure: isSecureRequest(req.headers, req.url) }),
    );
    logger.info({ event: 'gallery_gate_opened', galleryId: gallery.id });
    return res;
  },
  { route: 'POST /api/g/[slug]/access' },
);
