import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decrypt } from '../crypto.js';
import { hashSessionToken } from '../tokens.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createInquirySession,
  findActiveInquirySessionByTokenHash,
  getLatestInquiryConsent,
  recordInquirySessionConsent,
  revokeInquirySessions,
} from './inquiry-sessions.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const CONSENT = {
  acceptedAt: new Date('2026-10-20T10:00:00.000Z'),
  textKeys: ['consent.biometric', 'consent.processing'],
  locale: 'en',
  ip: '203.0.113.50',
  userAgent: 'SyntheticBrowser/2.0',
};

async function newSession(expiresAt = new Date(Date.now() + 24 * 3_600_000)) {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const tokenHash = hashSessionToken(`ovs_${testId('iqse')}`);
  const session = await createInquirySession(database.db, environment.id, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash,
    expiresAt,
  });
  return { environment, inquiry, tokenHash, session };
}

describe('inquiry sessions', () => {
  it('finds an active session by token hash', async () => {
    const { environment, inquiry, tokenHash, session } = await newSession();

    expect(session).toMatchObject({
      environmentId: environment.id,
      inquiryId: inquiry.id,
      consent: null,
      revokedAt: null,
    });
    expect(await findActiveInquirySessionByTokenHash(database.db, tokenHash)).toEqual(session);
  });

  it('ignores expired, revoked and unknown tokens', async () => {
    const now = new Date('2026-10-20T12:00:00.000Z');
    const expired = await newSession(now);
    const revoked = await newSession(new Date(now.getTime() + 60_000));

    expect(
      await revokeInquirySessions(database.db, revoked.environment.id, revoked.inquiry.id, now),
    ).toBe(1);
    expect(
      await findActiveInquirySessionByTokenHash(database.db, expired.tokenHash, now),
    ).toBeNull();
    expect(
      await findActiveInquirySessionByTokenHash(database.db, revoked.tokenHash, now),
    ).toBeNull();
    expect(
      await findActiveInquirySessionByTokenHash(database.db, hashSessionToken('nope'), now),
    ).toBeNull();
  });

  it('records consent with the IP and user agent encrypted inside the jsonb', async () => {
    const { environment, session } = await newSession();

    const updated = await recordInquirySessionConsent(
      database.db,
      environment.id,
      session.id,
      CONSENT,
    );
    const raw = await database.db.execute<{ consent: Record<string, string> }>(
      sql`select consent from inquiry_sessions where id = ${session.id}`,
    );
    const stored = raw.rows[0]?.consent ?? {};

    expect(updated?.consent).toEqual(CONSENT);
    expect(stored).toMatchObject({
      accepted_at: '2026-10-20T10:00:00.000Z',
      locale: 'en',
      text_keys: CONSENT.textKeys,
    });
    expect(JSON.stringify(stored)).not.toContain('203.0.113.50');
    expect(JSON.stringify(stored)).not.toContain('SyntheticBrowser');
    expect(
      decrypt(stored.user_agent ?? '', database.keyring, {
        context: 'inquiry_sessions.consent.user_agent',
      }),
    ).toBe('SyntheticBrowser/2.0');
  });

  it('stores consent without an IP or user agent as null', async () => {
    const { environment, session } = await newSession();

    const updated = await recordInquirySessionConsent(database.db, environment.id, session.id, {
      ...CONSENT,
      ip: null,
      userAgent: null,
    });

    expect(updated?.consent).toMatchObject({ ip: null, userAgent: null });
  });

  it('does not record consent on a revoked session or in another environment', async () => {
    const { environment, inquiry, session } = await newSession();
    const other = await createTestTenant(database.db);

    expect(
      await recordInquirySessionConsent(database.db, other.environment.id, session.id, CONSENT),
    ).toBeNull();
    await revokeInquirySessions(database.db, environment.id, inquiry.id);
    expect(
      await recordInquirySessionConsent(database.db, environment.id, session.id, CONSENT),
    ).toBeNull();
  });

  it('reads the latest consent given in any session of the inquiry', async () => {
    const { environment, inquiry, session } = await newSession();
    const later = await createInquirySession(database.db, environment.id, {
      id: testId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: hashSessionToken(testId('iqse')),
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(await getLatestInquiryConsent(database.db, environment.id, inquiry.id)).toBeNull();
    await recordInquirySessionConsent(database.db, environment.id, session.id, CONSENT);
    await recordInquirySessionConsent(database.db, environment.id, later.id, {
      ...CONSENT,
      acceptedAt: new Date('2026-10-20T11:00:00.000Z'),
      locale: 'es',
    });

    expect(await getLatestInquiryConsent(database.db, environment.id, inquiry.id)).toMatchObject({
      locale: 'es',
      acceptedAt: new Date('2026-10-20T11:00:00.000Z'),
    });
    const other = await createTestTenant(database.db);
    expect(await getLatestInquiryConsent(database.db, other.environment.id, inquiry.id)).toBeNull();
  });
});
