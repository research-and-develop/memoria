/**
 * Test-only helpers for two-factor sign-in: a fixed `TOTP_ENCRYPTION_KEY`,
 * authenticators and setup codes written straight to the test D1, and the
 * code an app would show.
 */
import type { Db } from '@repo/platform/ports';

import { run, statement } from '@repo/db/client';

import { setupCodeId } from '@/lib/auth/setupCode';
import { base32Decode, generateTotpSecret, totpCode, totpStep } from '@/lib/auth/totp';
import { authenticatorAad, twoFactorKeys } from '@/lib/auth/twoFactorKeys';
import { insertSetupCodeStatement } from '@/lib/db/queries/admin_setup_codes';

export const TEST_TOTP_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
export const TEST_TOTP_KEY_B64 = btoa(String.fromCharCode(...TEST_TOTP_KEY));

export const testKeys = () => twoFactorKeys(TEST_TOTP_KEY);

export type SeededAuthenticator = { id: string; secret: string };

/** An authenticator app, as first enrolment or the settings would store it. */
export async function seedAuthenticator(db: Db, input: { label?: string; secret?: string; lastStep?: number } = {}): Promise<SeededAuthenticator> {
  const id = crypto.randomUUID();
  const secret = input.secret ?? generateTotpSecret();
  const secretEnc = await (await testKeys()).encryptSecret(secret, authenticatorAad(id));
  await run(
    statement('INSERT INTO admin_authenticators (id, label, secret_enc, last_step) VALUES (?, ?, ?, ?)', [
      id,
      input.label ?? 'Test phone',
      secretEnc,
      input.lastStep ?? 0,
    ]),
    { db },
  );
  return { id, secret };
}

/** Recovery codes (normalised `xxxxx-xxxxx`) stored the way enrolment stores them. */
export async function seedRecoveryCodes(db: Db, codes: readonly string[]): Promise<void> {
  const keys = await testKeys();
  for (const code of codes) {
    await run(statement('INSERT INTO admin_recovery_codes (id) VALUES (?)', [await keys.recoveryCodeId(code)]), { db });
  }
}

/** A setup code, as `npm run admin:mfa -- setup` stores it. `code` is normalised (20 characters). */
export async function seedSetupCode(db: Db, code = 'ABCDEFGHIJKLMNOPQRST', expiresAt = new Date(Date.now() + 3600_000)): Promise<string> {
  await run(insertSetupCodeStatement(await setupCodeId(code), expiresAt.toISOString()), { db });
  return code;
}

/** The code `secret` (base32) shows at `now`, `drift` steps away. */
export async function codeFor(secret: string, now: Date | number = Date.now(), drift = 0): Promise<string> {
  const bytes = base32Decode(secret);
  if (!bytes) throw new Error('not base32');
  return totpCode(bytes, totpStep(now) + drift);
}
