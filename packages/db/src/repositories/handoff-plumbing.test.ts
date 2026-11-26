/**
 * Workflow 7A (H) (C94.6, C96.2, V02, V03): the shared plumbing of device handoff in the db.
 *
 * - `getEffectiveConsent`: the one consent every gate reads. A phone session a handoff created
 *   never acts on the desktop's consent, and a rejected phone's consent authorises nothing.
 * - `created_by_session_id`: the flow session that created a verification or a selfie capture.
 * - `deleteExpiredHandoffTokens`: the C16 pass deletes tokens 30 days past expiry (P27).
 *
 * Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import type { ConsentRecord } from '../schema.js';
import {
  createInquirySession,
  createSelfieCapture,
  createVerification,
  deleteExpiredHandoffTokens,
  getEffectiveConsent,
  getLatestInquiryConsent,
  getSelfieCapture,
  getVerification,
  recordInquirySessionConsent,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const NOW = new Date('2027-01-01T00:00:00.000Z');
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function seedInquiry() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, inquiryId: inquiry.id };
}

type Seeded = Awaited<ReturnType<typeof seedInquiry>>;

async function session(seeded: Seeded): Promise<string> {
  const id = testId('iqse');
  await createInquirySession(database.db, seeded.environmentId, {
    id,
    inquiryId: seeded.inquiryId,
    tokenHash: hashSessionToken(`ovs_${id}`),
    expiresAt: minutes(60),
  });
  return id;
}

/** A session a QR handoff from `fromSessionId` created, as `flow-handoff` will write it. */
async function phoneSession(seeded: Seeded, fromSessionId: string): Promise<string> {
  const id = await session(seeded);
  await database.db.execute(
    sql`update inquiry_sessions set device_handoff_method = 'qr',
          handoff_from_session_id = ${fromSessionId}, handoff_redeemed_at = ${NOW}
        where id = ${id}`,
  );
  return id;
}

async function consent(
  seeded: Seeded,
  sessionId: string,
  acceptedAt: Date,
  optionalTextKeys: string[] = [],
): Promise<ConsentRecord> {
  const record: ConsentRecord = {
    acceptedAt,
    textKeys: ['consent.terms'],
    optionalTextKeys,
    locale: 'en',
    ip: '192.0.2.10',
    userAgent: 'Synthetic/1.0',
  };
  await recordInquirySessionConsent(database.db, seeded.environmentId, sessionId, record);
  return record;
}

const holder = (seeded: Seeded, sessionId: string | null) => ({ ...seeded, sessionId });

describe('getEffectiveConsent (C94.6, V03)', () => {
  it('is the latest inquiry consent while no handoff created a session, for any holder', async () => {
    const seeded = await seedInquiry();
    const first = await session(seeded);
    const second = await session(seeded);
    await consent(seeded, first, minutes(1));
    const latest = await consent(seeded, second, minutes(2), ['consent.biometric-matching']);
    const inquiryLevel = await getLatestInquiryConsent(
      database.db,
      seeded.environmentId,
      seeded.inquiryId,
    );

    for (const sessionId of [first, second, null]) {
      expect(await getEffectiveConsent(database.db, holder(seeded, sessionId))).toEqual(
        inquiryLevel,
      );
    }
    expect(inquiryLevel?.optionalTextKeys).toEqual(latest.optionalTextKeys);
  });

  it('gives a phone session only its own consent: never the desktop one (V03, P01)', async () => {
    const seeded = await seedInquiry();
    const desktop = await session(seeded);
    await consent(seeded, desktop, minutes(1), ['consent.biometric-matching']);
    const phone = await phoneSession(seeded, desktop);

    expect(await getEffectiveConsent(database.db, holder(seeded, phone))).toBeNull();

    const own = await consent(seeded, phone, minutes(2));
    expect(await getEffectiveConsent(database.db, holder(seeded, phone))).toEqual(own);
  });

  it('keeps a phone on its own consent even when the desktop consented later', async () => {
    const seeded = await seedInquiry();
    const desktop = await session(seeded);
    const phone = await phoneSession(seeded, desktop);
    const own = await consent(seeded, phone, minutes(1));
    await consent(seeded, desktop, minutes(2), ['consent.device-recognition']);

    expect(await getEffectiveConsent(database.db, holder(seeded, phone))).toEqual(own);
  });

  it("lets a rejected phone's consent authorise nothing, for the phone and for the desktop (V02, V03)", async () => {
    const seeded = await seedInquiry();
    const desktop = await session(seeded);
    const desktopConsent = await consent(seeded, desktop, minutes(1));
    const phone = await phoneSession(seeded, desktop);
    await consent(seeded, phone, minutes(2), ['consent.biometric-matching']);
    await database.db.execute(
      sql`update inquiry_sessions set handoff_rejected_at = ${minutes(3)} where id = ${phone}`,
    );

    expect(await getEffectiveConsent(database.db, holder(seeded, phone))).toBeNull();
    expect(await getEffectiveConsent(database.db, holder(seeded, desktop))).toEqual(desktopConsent);
    expect(await getEffectiveConsent(database.db, holder(seeded, null))).toEqual(desktopConsent);
  });

  it("serves the desktop a phone's consent that was not rejected, as the latest of the inquiry", async () => {
    const seeded = await seedInquiry();
    const desktop = await session(seeded);
    await consent(seeded, desktop, minutes(1));
    const phone = await phoneSession(seeded, desktop);
    const phoneConsent = await consent(seeded, phone, minutes(2));

    expect(await getEffectiveConsent(database.db, holder(seeded, desktop))).toEqual(phoneConsent);
  });

  it('reads a session of another inquiry as no session of this one', async () => {
    const seeded = await seedInquiry();
    const desktop = await session(seeded);
    const desktopConsent = await consent(seeded, desktop, minutes(1));
    const other = await seedInquiry();
    const otherDesktop = await session(other);
    const foreignPhone = await phoneSession(other, otherDesktop);

    expect(await getEffectiveConsent(database.db, holder(seeded, foreignPhone))).toEqual(
      desktopConsent,
    );
  });
});

describe('created_by_session_id (V02)', () => {
  it('records the flow session that created a verification and a selfie capture', async () => {
    const seeded = await seedInquiry();
    const creator = await session(seeded);
    const verification = await createVerification(database.db, seeded.environmentId, {
      id: testId('ver'),
      inquiryId: seeded.inquiryId,
      type: 'selfie',
      createdBySessionId: creator,
    });
    const capture = await createSelfieCapture(database.db, seeded.environmentId, {
      id: testId('self'),
      verificationId: verification.id,
      inquiryId: seeded.inquiryId,
      method: 'camera',
      liveness: 'active',
      prompts: ['center'],
      nonceSha256: Buffer.alloc(32, 1),
      createdAt: NOW,
      expiresAt: minutes(3),
      createdBySessionId: creator,
    });

    expect(verification).toMatchObject({ createdBySessionId: creator, fromRejectedHandoff: false });
    expect(
      (await getVerification(database.db, seeded.environmentId, verification.id))
        ?.createdBySessionId,
    ).toBe(creator);
    expect(capture.createdBySessionId).toBe(creator);
    expect(
      (await getSelfieCapture(database.db, seeded.environmentId, capture.id))?.createdBySessionId,
    ).toBe(creator);
  });

  it('records none for an attempt the server created', async () => {
    const seeded = await seedInquiry();
    const verification = await createVerification(database.db, seeded.environmentId, {
      id: testId('ver'),
      inquiryId: seeded.inquiryId,
      type: 'government_id',
    });

    expect(verification.createdBySessionId).toBeNull();
  });
});

describe('deleteExpiredHandoffTokens (C96.2, P27)', () => {
  async function token(seeded: Seeded, issuing: string, expiresAt: Date, revoked: boolean) {
    const id = testId('hnd');
    await database.db.execute(
      sql`insert into handoff_tokens (id, environment_id, inquiry_id, issuing_session_id, step_id,
            method, token_hash, expires_at, revoked_at)
          values (${id}, ${seeded.environmentId}, ${seeded.inquiryId}, ${issuing},
            'device_handoff', 'qr', ${digest(id)}, ${expiresAt}, ${revoked ? expiresAt : null})`,
    );
    return id;
  }

  it('deletes tokens 30 days past their expiry, used or not, and keeps the younger ones', async () => {
    const seeded = await seedInquiry();
    const issuing = await session(seeded);
    const old = await token(seeded, issuing, daysAgo(31), true);
    const young = await token(seeded, issuing, daysAgo(29), true);
    const live = await token(seeded, issuing, minutes(5), false);

    expect(await deleteExpiredHandoffTokens(database.db, { now: NOW })).toBe(1);
    const left = await database.db.execute<{ id: string }>(
      sql`select id from handoff_tokens where inquiry_id = ${seeded.inquiryId} order by id`,
    );
    expect(left.rows.map((row) => row.id).sort()).toEqual([young, live].sort());
    expect(left.rows.map((row) => row.id)).not.toContain(old);
  });
});
