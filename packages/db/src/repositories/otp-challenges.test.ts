/**
 * C55.3-C55.6: the one-time code writes `api-otp` calls under the C40.6 locks: a code stored as
 * the verification's one open challenge (superseding the earlier one), an attempt reserved before
 * the compare (P09), a match confirming and releasing it, a code closed, and the delivery or its
 * failure recorded only while the code is still open. The code HMAC never outlives `sent`.
 * Every value is synthetic.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { otpDestinationIndex } from '../blind-index.js';
import { otpChallenges } from '../schema.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedOtpChallenge,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  closeOpenOtpChallenges,
  closeOtpChallenge,
  confirmOtpChallenge,
  createVerification,
  getOtpChallenge,
  getSentOtpChallenge,
  insertOtpChallenge,
  markOtpChallengeErrored,
  openOtpChallengeDestination,
  recordOtpDelivery,
  reserveOtpChallengeAttempt,
  type NewOtpChallenge,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const SENT = new Date('2026-10-23T09:00:00.000Z');
const EXPIRES = new Date('2026-10-23T09:10:00.000Z');
const LATER = new Date('2026-10-23T09:05:00.000Z');
const KEY = new Uint8Array(32).fill(3);
const NUMBER = '+12025550100';

async function phoneVerification() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'phone_number',
  });
  return { env: environment.id, inquiryId: inquiry.id, verificationId: verification.id };
}

function challenge(
  owner: { env: string; inquiryId: string; verificationId: string },
  overrides: Partial<NewOtpChallenge> = {},
): NewOtpChallenge {
  return {
    id: testId('otpc'),
    verificationId: owner.verificationId,
    inquiryId: owner.inquiryId,
    channel: 'sms',
    destination: NUMBER,
    destinationIndex: otpDestinationIndex(KEY, {
      environmentId: owner.env,
      channel: 'sms',
      destination: NUMBER,
    }),
    codeHmac: new Uint8Array(32).fill(1),
    codeKeyId: 'kek-1',
    provider: 'sandbox',
    sentAt: SENT,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

/** The stored code HMAC as plain bytes (PGlite reads a `bytea` as a Uint8Array, `pg` a Buffer). */
async function storedHmac(id: string): Promise<Uint8Array | null> {
  const [row] = await database.db
    .select({ codeHmac: otpChallenges.codeHmac })
    .from(otpChallenges)
    .where(eq(otpChallenges.id, id));
  return row?.codeHmac == null ? null : new Uint8Array(row.codeHmac);
}

describe('insertOtpChallenge (C55.3, C55.4)', () => {
  it('stores the code as the open challenge, its destination sealed to the row', async () => {
    const owner = await phoneVerification();
    const input = challenge(owner);

    const inserted = await insertOtpChallenge(database.db, owner.env, input);

    expect(inserted).toEqual({
      supersededId: null,
      challenge: {
        id: input.id,
        environmentId: owner.env,
        verificationId: owner.verificationId,
        inquiryId: owner.inquiryId,
        channel: 'sms',
        status: 'sent',
        failedAttempts: 0,
        codeKeyId: 'kek-1',
        provider: 'sandbox',
        providerMessageId: null,
        sentAt: SENT,
        expiresAt: EXPIRES,
        confirmedAt: null,
        errorCode: null,
        destinationIndex: input.destinationIndex,
        hasDestination: true,
        redactedAt: null,
      },
    });
    expect(await openOtpChallengeDestination(database.db, owner.env, input.id)).toBe(NUMBER);
    expect(await storedHmac(input.id)).toEqual(input.codeHmac);
  });

  it('supersedes the open challenge, clearing its code, so one stays open', async () => {
    const owner = await phoneVerification();
    const first = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, first);
    const second = challenge(owner, { sentAt: LATER, destination: '+12025550101' });

    const inserted = await insertOtpChallenge(database.db, owner.env, second);

    expect(inserted.supersededId).toBe(first.id);
    expect(await getOtpChallenge(database.db, owner.env, first.id)).toMatchObject({
      status: 'superseded',
    });
    expect(await storedHmac(first.id)).toBeNull();
    expect((await getSentOtpChallenge(database.db, owner.env, owner.verificationId))?.id).toBe(
      second.id,
    );
  });
});

describe('reserveOtpChallengeAttempt (C55.5, P09)', () => {
  it('counts the attempt before the compare and hands back the code HMAC', async () => {
    const owner = await phoneVerification();
    const input = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, input);

    const reserved = await reserveOtpChallengeAttempt(database.db, owner.env, input.id, LATER);

    expect(reserved?.challenge).toMatchObject({ id: input.id, failedAttempts: 1, status: 'sent' });
    expect(reserved?.codeHmac).toEqual(input.codeHmac);
  });

  it('takes at most five attempts per code', async () => {
    const owner = await phoneVerification();
    const input = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, input);

    const counts: (number | null)[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const reserved = await reserveOtpChallengeAttempt(database.db, owner.env, input.id, LATER);
      counts.push(reserved?.challenge.failedAttempts ?? null);
    }

    expect(counts).toEqual([1, 2, 3, 4, 5, null]);
  });

  it('takes none once the code expired at the given time, left sent or is elsewhere', async () => {
    const owner = await phoneVerification();
    const open = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, open);
    const closed = await seedOtpChallenge(database.db, owner.env, {
      verificationId: owner.verificationId,
      inquiryId: owner.inquiryId,
      channel: 'sms',
      destination: NUMBER,
      status: 'exhausted',
    });
    const elsewhere = await phoneVerification();

    expect(await reserveOtpChallengeAttempt(database.db, owner.env, open.id, EXPIRES)).toBeNull();
    expect(await reserveOtpChallengeAttempt(database.db, owner.env, closed, LATER)).toBeNull();
    expect(await reserveOtpChallengeAttempt(database.db, elsewhere.env, open.id, LATER)).toBeNull();
    expect(await getOtpChallenge(database.db, owner.env, open.id)).toMatchObject({
      failedAttempts: 0,
    });
  });
});

describe('confirming and closing a code (C55.4, C55.5, C53.5)', () => {
  it('a match confirms the challenge, releases its attempt and clears the code', async () => {
    const owner = await phoneVerification();
    const input = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, input);
    await reserveOtpChallengeAttempt(database.db, owner.env, input.id, LATER);

    const confirmed = await confirmOtpChallenge(database.db, owner.env, input.id, LATER);

    expect(confirmed).toMatchObject({ status: 'confirmed', failedAttempts: 0, confirmedAt: LATER });
    expect(await storedHmac(input.id)).toBeNull();
    expect(await confirmOtpChallenge(database.db, owner.env, input.id, LATER)).toBeNull();
  });

  it.each(['expired', 'exhausted', 'superseded'] as const)(
    'closes an open code as %s, clearing it, and leaves a closed one alone',
    async (status) => {
      const owner = await phoneVerification();
      const input = challenge(owner);
      await insertOtpChallenge(database.db, owner.env, input);

      const closed = await closeOtpChallenge(database.db, owner.env, input.id, status);

      expect(closed).toMatchObject({ id: input.id, status });
      expect(await storedHmac(input.id)).toBeNull();
      expect(await closeOtpChallenge(database.db, owner.env, input.id, 'expired')).toBeNull();
    },
  );

  it('closes the open code of a verification that is canceled or submitted', async () => {
    const owner = await phoneVerification();
    const input = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, input);

    expect(
      await closeOpenOtpChallenges(database.db, owner.env, owner.verificationId, 'superseded'),
    ).toBe(1);
    expect(
      await closeOpenOtpChallenges(database.db, owner.env, owner.verificationId, 'superseded'),
    ).toBe(0);
    expect(await getOtpChallenge(database.db, owner.env, input.id)).toMatchObject({
      status: 'superseded',
    });
    expect(await storedHmac(input.id)).toBeNull();
  });
});

describe('after the delivery (C55.6)', () => {
  it('records the provider message id of a code still open', async () => {
    const owner = await phoneVerification();
    const input = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, input);

    expect(await recordOtpDelivery(database.db, owner.env, input.id, 'SM-synthetic-1')).toBe(true);
    expect(await getOtpChallenge(database.db, owner.env, input.id)).toMatchObject({
      status: 'sent',
      providerMessageId: 'SM-synthetic-1',
    });
  });

  it('records nothing on a code superseded or redacted meanwhile', async () => {
    const owner = await phoneVerification();
    const superseded = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, superseded);
    const redacted = challenge(owner, { sentAt: LATER });
    await insertOtpChallenge(database.db, owner.env, redacted);
    await database.db
      .update(otpChallenges)
      .set({ redactedAt: LATER, destinationSealed: null, destinationIndex: null })
      .where(eq(otpChallenges.id, redacted.id));

    expect(await recordOtpDelivery(database.db, owner.env, superseded.id, 'SM-1')).toBe(false);
    expect(await recordOtpDelivery(database.db, owner.env, redacted.id, 'SM-2')).toBe(false);
    expect(await getOtpChallenge(database.db, owner.env, redacted.id)).toMatchObject({
      providerMessageId: null,
    });
  });

  it('a failed delivery errors the open code, clears it and keeps the failure code only', async () => {
    const owner = await phoneVerification();
    const input = challenge(owner);
    await insertOtpChallenge(database.db, owner.env, input);

    expect(await markOtpChallengeErrored(database.db, owner.env, input.id, 'twilio_rejected')).toBe(
      true,
    );
    expect(await getOtpChallenge(database.db, owner.env, input.id)).toMatchObject({
      status: 'errored',
      errorCode: 'twilio_rejected',
    });
    expect(await storedHmac(input.id)).toBeNull();
    expect(await markOtpChallengeErrored(database.db, owner.env, input.id, 'again')).toBe(false);
  });
});
