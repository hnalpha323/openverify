/**
 * C42.3 (Workflow 4A Stage 3, api-flow): the consent record keeps the optional consent texts the
 * user ticked (`optional_text_keys` in the jsonb), such as `consent.biometric-matching`. A consent
 * recorded before Phase 4 has none stored and reads without the member.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  getLatestInquiryConsent,
  recordInquirySessionConsent,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const CONSENT = {
  acceptedAt: new Date('2026-10-21T10:00:00.000Z'),
  textKeys: ['consent.biometric', 'consent.processing'],
  locale: 'en',
  ip: '203.0.113.50',
  userAgent: 'SyntheticBrowser/2.0',
};

async function newSession() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const session = await createInquirySession(database.db, environment.id, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { environmentId: environment.id, inquiryId: inquiry.id, session };
}

describe('the optional consent texts (C42.3)', () => {
  it('are stored and read back with the consent', async () => {
    const { environmentId, inquiryId, session } = await newSession();

    await recordInquirySessionConsent(database.db, environmentId, session.id, {
      ...CONSENT,
      optionalTextKeys: ['consent.biometric-matching'],
    });
    const raw = await database.db.execute<{ consent: Record<string, unknown> }>(
      sql`select consent from inquiry_sessions where id = ${session.id}`,
    );

    expect(raw.rows[0]?.consent).toMatchObject({
      optional_text_keys: ['consent.biometric-matching'],
    });
    expect(await getLatestInquiryConsent(database.db, environmentId, inquiryId)).toEqual({
      ...CONSENT,
      optionalTextKeys: ['consent.biometric-matching'],
    });
  });

  it('are an empty list when the user ticked none', async () => {
    const { environmentId, inquiryId, session } = await newSession();

    await recordInquirySessionConsent(database.db, environmentId, session.id, {
      ...CONSENT,
      optionalTextKeys: [],
    });

    expect(
      (await getLatestInquiryConsent(database.db, environmentId, inquiryId))?.optionalTextKeys,
    ).toEqual([]);
  });

  it('are absent from a consent recorded before Phase 4', async () => {
    const { environmentId, inquiryId, session } = await newSession();

    await recordInquirySessionConsent(database.db, environmentId, session.id, CONSENT);
    const raw = await database.db.execute<{ consent: Record<string, unknown> }>(
      sql`select consent from inquiry_sessions where id = ${session.id}`,
    );

    expect(raw.rows[0]?.consent).not.toHaveProperty('optional_text_keys');
    expect(await getLatestInquiryConsent(database.db, environmentId, inquiryId)).toEqual(CONSENT);
  });
});
