/**
 * C55.5-C55.7: the per-verification OTP counts `api-otp` writes under the C40.6 locks: a send
 * reserved before delivery and released when it errors (so an errored send never counts), wrong
 * entries capped, the limit refusal that lets the user continue to review, and the lock that
 * serializes the SMS budget's trip record. Counts and a reason only; every id is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createVerification,
  getOtpVerificationState,
  lockOtpSmsBudget,
  recordOtpLimited,
  recordOtpWrongEntry,
  releaseOtpSend,
  reserveOtpSend,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-23T09:00:00.000Z');
const LATER = new Date('2026-10-23T09:05:00.000Z');

async function owner() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'email_address',
  });
  return {
    env: environment.id,
    ids: { verificationId: verification.id, inquiryId: inquiry.id },
  };
}

describe('sends (C55.6)', () => {
  it('counts each reserved send, up to the cap, creating the row on the first', async () => {
    const { env, ids } = await owner();

    const counts: (number | null)[] = [];
    for (let send = 0; send < 4; send += 1) {
      counts.push((await reserveOtpSend(database.db, env, ids, 3))?.sends ?? null);
    }

    expect(counts).toEqual([1, 2, 3, null]);
    expect(await getOtpVerificationState(database.db, env, ids.verificationId)).toMatchObject({
      sends: 3,
      wrongEntries: 0,
      limitedAt: null,
      limitedReason: null,
    });
  });

  it('releases a send whose delivery failed, never below zero', async () => {
    const { env, ids } = await owner();
    await reserveOtpSend(database.db, env, ids, 5);

    expect((await releaseOtpSend(database.db, env, ids.verificationId))?.sends).toBe(0);
    expect((await releaseOtpSend(database.db, env, ids.verificationId))?.sends).toBe(0);
    const none = await owner();
    expect(await releaseOtpSend(database.db, none.env, none.ids.verificationId)).toBeNull();
  });
});

describe('wrong entries (C55.5)', () => {
  it('counts each wrong entry across codes, capped at the maximum', async () => {
    const { env, ids } = await owner();

    const counts: number[] = [];
    for (let entry = 0; entry < 4; entry += 1) {
      counts.push((await recordOtpWrongEntry(database.db, env, ids, 3)).wrongEntries);
    }

    expect(counts).toEqual([1, 2, 3, 3]);
  });
});

describe('limit refusals (C55.6)', () => {
  it('records when and why a limit refused the user; the latest refusal is kept', async () => {
    const { env, ids } = await owner();
    await reserveOtpSend(database.db, env, ids, 5);

    await recordOtpLimited(database.db, env, ids, 'destination', AT);
    const latest = await recordOtpLimited(database.db, env, ids, 'store_unavailable', LATER);

    expect(latest).toMatchObject({
      sends: 1,
      limitedAt: LATER,
      limitedReason: 'store_unavailable',
    });
  });

  it('records a refusal before any send', async () => {
    const { env, ids } = await owner();

    expect(await recordOtpLimited(database.db, env, ids, 'inquiry', AT)).toMatchObject({
      sends: 0,
      wrongEntries: 0,
      limitedAt: AT,
      limitedReason: 'inquiry',
    });
  });
});

describe('the SMS budget lock (C55.7)', () => {
  it('is taken inside a transaction, for one environment at a time', async () => {
    const { env } = await owner();

    await expect(
      database.db.transaction(async (tx) => {
        await lockOtpSmsBudget(tx, env);
        await lockOtpSmsBudget(tx, env);
        return 'locked';
      }),
    ).resolves.toBe('locked');
  });
});
