import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { batch, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { useAuthenticatorStepStatement } from '../admin_authenticators';
import { useRecoveryCodeStatement } from '../admin_recovery_codes';
import { insertSetupCodeStatement, spendSetupCodeStatement } from '../admin_setup_codes';

import { acceptSetupCodeStatement, countChallengeAttempt, createSignInChallengeStatement, getLiveChallenge } from './index';

/**
 * The guarded writes of two-factor sign-in (plan p02 → Writes that must not
 * race), on a test D1: each refuses when its precondition no longer holds.
 */
let testDb: TestDb;
const opts = () => ({ db: testDb.db });
const HEX = (c: string) => c.repeat(64);
const now = () => new Date().toISOString();
const later = (ms = 600_000) => new Date(Date.now() + ms).toISOString();

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

const challenge = (id: string, kind: 'login' | 'enroll' = 'login') =>
  run(createSignInChallengeStatement({ id, kind, passwordVersion: 'pv', userAgent: 'x'.repeat(400), expiresAt: later() }), opts());

describe('admin_mfa_challenges', () => {
  it('counts attempts up to five, then refuses', async () => {
    await challenge(HEX('a'));
    for (let i = 1; i <= 5; i++) expect(await countChallengeAttempt(HEX('a'), now(), opts())).toBe(i);
    expect(await countChallengeAttempt(HEX('a'), now(), opts())).toBeNull();
    expect(await countChallengeAttempt(HEX('b'), now(), opts())).toBeNull();
  });

  it('does not count on an expired challenge, and getLiveChallenge hides it', async () => {
    await challenge(HEX('a'));
    const after = later(700_000);
    expect(await countChallengeAttempt(HEX('a'), after, opts())).toBeNull();
    expect(await getLiveChallenge(HEX('a'), after, opts())).toBeNull();
    expect((await getLiveChallenge(HEX('a'), now(), opts()))?.user_agent).toHaveLength(300);
  });

  it('accepts a setup code once, only while it is live', async () => {
    await challenge(HEX('a'), 'enroll');
    const accept = (setup: string) => run(acceptSetupCodeStatement({ challengeId: HEX('a'), setupCodeId: setup, pendingSecretEnc: 'v1:x', now: now() }), opts());
    expect((await accept(HEX('c'))).changes).toBe(0);
    await run(insertSetupCodeStatement(HEX('c'), later()), opts());
    expect((await accept(HEX('c'))).changes).toBe(1);
    expect((await accept(HEX('c'))).changes).toBe(0);
  });

  it('the CHECKs keep each kind to its own columns', async () => {
    const insert = (kind: string, session: string | null, setup: string | null, secret: string | null) =>
      run(
        statement(
          'INSERT INTO admin_mfa_challenges (id, kind, password_version, session_id, setup_code_id, pending_secret_enc, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [crypto.randomUUID(), kind, 'pv', session, setup, secret, later()],
        ),
        opts(),
      );
    await expect(insert('login', null, null, 'v1:x')).rejects.toThrow(/CHECK/);
    await expect(insert('login', 's', null, null)).rejects.toThrow(/CHECK/);
    await expect(insert('enroll', null, HEX('c'), null)).rejects.toThrow(/CHECK/);
    await expect(insert('add', 's', null, null)).rejects.toThrow(/CHECK/);
    await expect(insert('add', 's', HEX('c'), 'v1:x')).rejects.toThrow(/CHECK/);
    await expect(insert('other', null, null, null)).rejects.toThrow(/CHECK/);
    await insert('login', null, null, null);
    await insert('enroll', null, null, null);
    await insert('enroll', null, HEX('c'), 'v1:x');
    await insert('add', 's', null, 'v1:x');
  });
});

describe('the code writes need a live challenge', () => {
  it('an authenticator step moves forward only, and only while the challenge lives', async () => {
    await challenge(HEX('a'));
    await run(statement("INSERT INTO admin_authenticators (id, label, secret_enc, last_step) VALUES ('app', 'Phone', 'v1:x', 100)"), opts());
    const use = (step: number, challengeId: string | null = HEX('a')) => run(useAuthenticatorStepStatement({ id: 'app', step, now: now(), challengeId }), opts());
    expect((await use(100)).changes).toBe(0);
    expect((await use(101)).changes).toBe(1);
    expect((await use(101)).changes).toBe(0);
    expect((await use(102, HEX('b'))).changes).toBe(0);
    await run(statement('DELETE FROM admin_mfa_challenges'), opts());
    expect((await use(102)).changes).toBe(0);
    expect((await use(102, null)).changes).toBe(1);
  });

  it('a recovery code is used once, only while the challenge lives', async () => {
    await challenge(HEX('a'));
    await run(statement('INSERT INTO admin_recovery_codes (id) VALUES (?)', [HEX('r')]), opts());
    const use = (challengeId: string) => run(useRecoveryCodeStatement({ id: HEX('r'), now: now(), challengeId }), opts());
    expect((await use(HEX('b'))).changes).toBe(0);
    expect((await use(HEX('a'))).changes).toBe(1);
    expect((await use(HEX('a'))).changes).toBe(0);
  });

  it('a setup code is spent only with its challenge, while no authenticator exists', async () => {
    await challenge(HEX('a'), 'enroll');
    await run(insertSetupCodeStatement(HEX('c'), later()), opts());
    await run(acceptSetupCodeStatement({ challengeId: HEX('a'), setupCodeId: HEX('c'), pendingSecretEnc: 'v1:x', now: now() }), opts());
    const spend = (challengeId = HEX('a')) => batch([spendSetupCodeStatement({ setupCodeId: HEX('c'), challengeId, now: now() })], opts());

    expect((await spend(HEX('b')))[0]?.changes).toBe(0);
    await run(statement("INSERT INTO admin_authenticators (id, label, secret_enc, last_step) VALUES ('app', 'Phone', 'v1:x', 1)"), opts());
    expect((await spend())[0]?.changes).toBe(0);
    await run(statement('DELETE FROM admin_authenticators'), opts());
    expect((await spend())[0]?.changes).toBe(1);
    expect(await first(statement('SELECT id FROM admin_setup_codes'), opts())).toBeNull();
  });
});
