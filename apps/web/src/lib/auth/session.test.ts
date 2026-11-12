import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { batch, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { prepareSession, resolveSession, SESSION_IDLE_MS, SESSION_MAX_MS, sessionCookie, sessionExpiry } from './session';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });
const HASH = 'pbkdf2-sha256$1000$test$test';
const DAY = 24 * 3600_000;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

/** A session created at `createdAt` (the DB default is "now", so it is set explicitly). */
async function sessionAt(createdAt: Date): Promise<{ token: string; id: string }> {
  const s = await prepareSession({ passwordHash: HASH, userAgent: 'vitest', secondFactor: 'recovery_code', authenticatorId: null, country: null, now: createdAt });
  await batch(s.statements({ sql: '1 = 1', params: [] }), opts());
  const iso = createdAt.toISOString();
  await run(statement('UPDATE admin_sessions SET created_at = ?, last_seen_at = ? WHERE id = ?', [iso, iso, s.id]), opts());
  return { token: s.token, id: s.id };
}

const expiresAt = async (id: string) => (await first<{ expires_at: string }>(statement('SELECT expires_at FROM admin_sessions WHERE id = ?', [id]), opts()))?.expires_at;

describe('session limits (D2.10)', () => {
  it('the cookie lives 90 days; the server enforces the rest', () => {
    expect(sessionCookie('t', true).options.maxAge).toBe(90 * 24 * 3600);
  });

  it.each([
    ['fresh', 0, 0, SESSION_IDLE_MS],
    ['used on day 80: capped at day 90', 80 * DAY, 80 * DAY, SESSION_MAX_MS],
    ['used on day 60: 14 more days', 60 * DAY, 60 * DAY, 74 * DAY],
  ])('sessionExpiry: %s', (_label, _created, lastSeen, expected) => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    expect(sessionExpiry(created, new Date(created.getTime() + lastSeen))).toBe(new Date(created.getTime() + expected).toISOString());
  });

  it('a refresh never extends past 90 days after sign-in', async () => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    const { token, id } = await sessionAt(created);
    // Keep it alive by using it every 10 days.
    for (let day = 10; day <= 80; day += 10) {
      await run(statement('UPDATE admin_sessions SET expires_at = ? WHERE id = ?', [sessionExpiry(created, new Date(created.getTime() + (day - 10) * DAY)), id]), opts());
      const session = await resolveSession(token, { passwordHash: HASH, now: new Date(created.getTime() + day * DAY) }, opts());
      expect(session).not.toBeNull();
    }
    expect(await expiresAt(id)).toBe(new Date(created.getTime() + SESSION_MAX_MS).toISOString());
    expect(await resolveSession(token, { passwordHash: HASH, now: new Date(created.getTime() + 90 * DAY + 1) }, opts())).toBeNull();
  });

  it('a session older than 90 days is refused and deleted, whatever its expires_at says', async () => {
    const created = new Date(Date.now() - 91 * DAY);
    const { token, id } = await sessionAt(created);
    await run(statement('UPDATE admin_sessions SET expires_at = ? WHERE id = ?', [new Date(Date.now() + DAY).toISOString(), id]), opts());
    expect(await resolveSession(token, { passwordHash: HASH }, opts())).toBeNull();
    expect(await expiresAt(id)).toBeUndefined();
  });

  it('14 days without use end it', async () => {
    const created = new Date(Date.now() - 20 * DAY);
    const { token } = await sessionAt(created);
    expect(await resolveSession(token, { passwordHash: HASH }, opts())).toBeNull();
  });

  it('reports how the session signed in', async () => {
    const { token } = await sessionAt(new Date());
    expect(await resolveSession(token, { passwordHash: HASH }, opts())).toMatchObject({ secondFactor: 'recovery_code', authenticatorId: null, verifiedUntil: null });
  });

  it('a conditional insert writes nothing (and no audit row) when its condition fails', async () => {
    const s = await prepareSession({ passwordHash: HASH, userAgent: 'x', secondFactor: 'authenticator', authenticatorId: 'a', country: 'BG', now: new Date() });
    await batch(s.statements({ sql: '1 = 0', params: [] }), opts());
    expect(await expiresAt(s.id)).toBeUndefined();
    expect(await first(statement('SELECT id FROM audit_log'), opts())).toBeNull();
  });
});
