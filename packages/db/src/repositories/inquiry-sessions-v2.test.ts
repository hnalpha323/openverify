/** Phase 2 inquiry sessions (C10): status, start, expiry, cancelation and listing. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { InvalidCursorError } from '../errors.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  cancelInquirySessions,
  createInquirySession,
  expireInquirySession,
  expireInquirySessions,
  findActiveInquirySessionByTokenHash,
  findInquirySessionByTokenHash,
  getInquirySession,
  inquirySessionState,
  listInquirySessions,
  listOverdueInquirySessions,
  markInquirySessionStarted,
  revokeInquirySessions,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const open = (expiresAt = new Date(Date.now() + 3_600_000)) => {
    const token = `ovs_${testId('iqse')}`;
    return createInquirySession(database.db, environment.id, {
      id: testId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    }).then((session) => ({ session, tokenHash: hashSessionToken(token) }));
  };
  return { env: environment.id, inquiry, open };
}

describe('inquiry session lifecycle', () => {
  it('starts once, sealing the first call IP and user agent', async () => {
    const { env, open } = await setup();
    const { session } = await open();
    const at = new Date('2026-10-20T09:00:00.000Z');

    const started = await markInquirySessionStarted(database.db, env, session.id, {
      at,
      ip: '203.0.113.5',
      userAgent: 'SyntheticBrowser/2.0',
    });
    const again = await markInquirySessionStarted(database.db, env, session.id, {
      ip: '198.51.100.1',
    });
    const raw = await database.db.execute<{ ip: string; user_agent: string }>(
      sql`select ip, user_agent from inquiry_sessions where id = ${session.id}`,
    );

    expect(started).toMatchObject({
      startedAt: at,
      ip: '203.0.113.5',
      userAgent: 'SyntheticBrowser/2.0',
    });
    expect(again).toBeNull();
    expect(raw.rows[0]?.ip).toMatch(/^ov1\./);
    expect(JSON.stringify(raw.rows[0])).not.toContain('203.0.113.5');
    expect(await getInquirySession(database.db, env, session.id)).toEqual(started);
  });

  it('expires one session, then stops finding it as active', async () => {
    const { env, open } = await setup();
    const { session, tokenHash } = await open();

    const expired = await expireInquirySession(database.db, env, session.id);
    const twice = await expireInquirySession(database.db, env, session.id);
    const found = await findInquirySessionByTokenHash(database.db, tokenHash);

    expect(expired).toMatchObject({ status: 'expired', expiredAt: expect.any(Date) as Date });
    expect(expired?.revokedAt).toBeInstanceOf(Date);
    expect(twice).toBeNull();
    expect(found?.id).toBe(session.id);
    expect(await findActiveInquirySessionByTokenHash(database.db, tokenHash)).toBeNull();
    expect(inquirySessionState(found ?? session)).toBe('expired');
  });

  it('expires all or cancels all active sessions of an inquiry', async () => {
    const { env, inquiry, open } = await setup();
    const { session: a } = await open();
    const { session: b } = await open();
    const { session: c } = await open();
    await expireInquirySession(database.db, env, c.id);

    const expired = await expireInquirySessions(database.db, env, inquiry.id);
    const canceled = await cancelInquirySessions(database.db, env, inquiry.id);
    const { session: d } = await open();
    const canceledLater = await cancelInquirySessions(database.db, env, inquiry.id);

    expect(expired.map((session) => session.id).sort()).toEqual([a.id, b.id].sort());
    expect(canceled).toEqual([]);
    expect(canceledLater).toEqual([
      expect.objectContaining({
        id: d.id,
        status: 'canceled',
        canceledAt: expect.any(Date) as Date,
      }),
    ]);
    expect(inquirySessionState(canceledLater[0] ?? d)).toBe('canceled');
  });

  it('cancels active sessions through the Phase 1 revoke as well', async () => {
    const { env, inquiry, open } = await setup();
    const { session } = await open();

    expect(await revokeInquirySessions(database.db, env, inquiry.id)).toBe(1);
    expect((await getInquirySession(database.db, env, session.id))?.status).toBe('canceled');
  });

  it('derives the state from the TTL before the sweep has run', async () => {
    const { open } = await setup();
    const { session } = await open(new Date(Date.now() - 1000));

    expect(inquirySessionState(session)).toBe('expired');
    expect(inquirySessionState(session, new Date(Date.now() - 60_000))).toBe('active');
  });

  it('lists sessions by inquiry and status with the C1 cursor', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, inquiry, open } = await setup();
    const clock = createdAtClock(database.db);
    const { session: a } = await open();
    await clock.at('inquiry_sessions', a.id);
    const { session: b } = await open();
    await clock.at('inquiry_sessions', b.id);
    await expireInquirySession(database.db, env, a.id);
    const other = await setup();
    await other.open();

    const all = await listInquirySessions(database.db, env, {});
    const byInquiry = await listInquirySessions(database.db, env, {
      inquiryId: inquiry.id,
      size: 1,
    });
    const active = await listInquirySessions(database.db, env, { status: 'active' });

    expect(all.items.map((session) => session.id)).toEqual([b.id, a.id]);
    expect(byInquiry).toMatchObject({ items: [{ id: b.id }], next: b.id });
    expect(active.items.map((session) => session.id)).toEqual([b.id]);
    expect((await listInquirySessions(database.db, env, { status: [] })).items).toEqual([]);
    await expect(listInquirySessions(database.db, env, { after: testId('iqse') })).rejects.toThrow(
      InvalidCursorError,
    );
  });

  it('keeps sessions inside their environment', async () => {
    const { inquiry, open } = await setup();
    const { session } = await open();
    const other = (await createTestTenant(database.db)).environment.id;

    expect(await getInquirySession(database.db, other, session.id)).toBeNull();
    expect(await expireInquirySession(database.db, other, session.id)).toBeNull();
    expect(await markInquirySessionStarted(database.db, other, session.id, {})).toBeNull();
    expect(await expireInquirySessions(database.db, other, inquiry.id)).toEqual([]);
  });
});

describe('the C10 session expiry sweep', () => {
  it('selects active sessions past their TTL, across environments, and can lock them', async () => {
    const first = await setup();
    const second = await setup();
    const { session: a } = await first.open(new Date('2001-01-01T00:00:00.000Z'));
    const { session: b } = await second.open(new Date('2001-01-02T00:00:00.000Z'));
    const { session: c } = await first.open(new Date('2001-01-01T00:00:00.000Z'));
    await cancelInquirySessions(database.db, first.env, first.inquiry.id);
    await first.open();
    const now = new Date('2002-01-01T00:00:00.000Z');

    const due = await listOverdueInquirySessions(database.db, { now });
    const locked = await database.db.transaction((tx) =>
      listOverdueInquirySessions(tx, { now, lock: true, limit: 1 }),
    );

    expect(due.map((row) => row.id)).toEqual([b.id]);
    expect(due[0]).toMatchObject({ environmentId: second.env, inquiryId: second.inquiry.id });
    expect(locked.map((row) => row.id)).toEqual([b.id]);
    expect([a.id, c.id]).not.toContain(due[0]?.id);
  });
});
