/**
 * C96.2, C96.3, C96.7 (Workflow 7A, `flow-handoff`): the device handoff tokens, the handoff state
 * per inquiry and step, the phone's session and its rejection, the rejected-handoff marks, the
 * confirmed-destination read and the distance facts.
 *
 * - A token is stored as its digest only, single use, and one is live per issuing session: a new
 *   one revokes the previous. Redeeming, revoking and declining act only on a live token, so of
 *   two racing calls one wins.
 * - The state of a handoff step is kept per inquiry and step (V05).
 * - The phone's session carries its three handoff fields together; a rejection marks it and
 *   cancels it while active, once (V02).
 *
 * Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { otpDestinationIndex } from '../blind-index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  confirmOtpChallenge,
  createHandoffSession,
  createInquirySession,
  createVerification,
  findActiveHandoffSession,
  findHandoffTokenByHash,
  getInquirySession,
  getVerification,
  hasConfirmedOtpDestination,
  hasRejectedHandoffVerifications,
  insertOtpChallenge,
  issueHandoffToken,
  latestHandoffToken,
  listInquiryHandoffSteps,
  lockHandoffToken,
  markHandoffTokenRedeemed,
  markVerificationsFromRejectedHandoff,
  recordHandoffCodeAttempt,
  recordHandoffDistanceFacts,
  rejectHandoffSession,
  revokeHandoffToken,
  setInquiryHandoffStepState,
  type NewHandoffToken,
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
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const BLIND_INDEX_KEY = new Uint8Array(32).fill(7);

async function seedInquiry() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, inquiryId: inquiry.id };
}

type Seeded = Awaited<ReturnType<typeof seedInquiry>>;

async function desktop(seeded: Seeded): Promise<string> {
  const id = testId('iqse');
  await createInquirySession(database.db, seeded.environmentId, {
    id,
    inquiryId: seeded.inquiryId,
    tokenHash: hashSessionToken(`ovs_${id}`),
    expiresAt: minutes(60),
  });
  return id;
}

function newToken(
  seeded: Seeded,
  issuingSessionId: string,
  overrides: Partial<NewHandoffToken> = {},
) {
  const raw = `ovh_${testId('hnd')}`;
  return {
    raw,
    token: {
      id: testId('hnd'),
      inquiryId: seeded.inquiryId,
      issuingSessionId,
      stepId: 'device_handoff',
      method: 'qr',
      tokenHash: digest(raw),
      confirmationCodeHash: null,
      destinationConfirmed: true,
      expiresAt: minutes(5),
      at: NOW,
      ...overrides,
    } satisfies NewHandoffToken,
  };
}

async function phone(seeded: Seeded, fromSessionId: string, expiresAt = minutes(60)) {
  const id = testId('iqse');
  return createHandoffSession(database.db, seeded.environmentId, {
    id,
    inquiryId: seeded.inquiryId,
    tokenHash: hashSessionToken(`ovs_${id}`),
    expiresAt,
    method: 'qr',
    fromSessionId,
    redeemedAt: NOW,
  });
}

describe('issueHandoffToken (C96.2)', () => {
  it('stores the digests only, and a new token revokes the session’s live one', async () => {
    const seeded = await seedInquiry();
    const issuing = await desktop(seeded);
    const first = newToken(seeded, issuing);
    const second = newToken(seeded, issuing);

    const stored = await issueHandoffToken(database.db, seeded.environmentId, first.token);
    expect(stored).toMatchObject({
      id: first.token.id,
      tokenHash: first.token.tokenHash,
      redeemedAt: null,
      revokedAt: null,
      codeAttempts: 0,
    });
    expect(JSON.stringify(stored)).not.toContain(first.raw);

    await issueHandoffToken(database.db, seeded.environmentId, { ...second.token, at: minutes(1) });

    expect(await findHandoffTokenByHash(database.db, first.token.tokenHash)).toMatchObject({
      revokedAt: minutes(1),
      declinedAt: null,
    });
    expect(await findHandoffTokenByHash(database.db, second.token.tokenHash)).toMatchObject({
      revokedAt: null,
    });
  });

  it('finds a token by its digest across environments, and nothing for an unknown digest', async () => {
    const seeded = await seedInquiry();
    const { token } = newToken(seeded, await desktop(seeded));
    await issueHandoffToken(database.db, seeded.environmentId, token);

    expect(await findHandoffTokenByHash(database.db, token.tokenHash)).toMatchObject({
      environmentId: seeded.environmentId,
      inquiryId: seeded.inquiryId,
    });
    expect(await findHandoffTokenByHash(database.db, digest('unknown'))).toBeNull();
  });

  it('locks a token of its environment only', async () => {
    const seeded = await seedInquiry();
    const other = await seedInquiry();
    const { token } = newToken(seeded, await desktop(seeded));
    await issueHandoffToken(database.db, seeded.environmentId, token);

    await database.db.transaction(async (tx) => {
      expect(await lockHandoffToken(tx, seeded.environmentId, token.id)).toMatchObject({
        id: token.id,
      });
      expect(await lockHandoffToken(tx, other.environmentId, token.id)).toBeNull();
    });
  });
});

describe('redeeming, revoking and declining act on a live token only (C96.2, V04)', () => {
  it('redeems a live token once', async () => {
    const seeded = await seedInquiry();
    const issuing = await desktop(seeded);
    const { token } = newToken(seeded, issuing);
    await issueHandoffToken(database.db, seeded.environmentId, token);
    const redeemer = await phone(seeded, issuing);

    const redeemed = await markHandoffTokenRedeemed(database.db, seeded.environmentId, {
      tokenId: token.id,
      redeemedSessionId: redeemer.id,
      at: minutes(1),
    });
    expect(redeemed).toMatchObject({ redeemedAt: minutes(1), redeemedSessionId: redeemer.id });
    expect(
      await markHandoffTokenRedeemed(database.db, seeded.environmentId, {
        tokenId: token.id,
        redeemedSessionId: redeemer.id,
        at: minutes(2),
      }),
    ).toBeNull();
    expect(
      await revokeHandoffToken(database.db, seeded.environmentId, token.id, { at: minutes(2) }),
    ).toBeNull();
  });

  it('never redeems an expired or a revoked token', async () => {
    const seeded = await seedInquiry();
    const issuing = await desktop(seeded);
    const expired = newToken(seeded, issuing, { expiresAt: minutes(5) });
    await issueHandoffToken(database.db, seeded.environmentId, expired.token);
    const redeemer = await phone(seeded, issuing);

    expect(
      await markHandoffTokenRedeemed(database.db, seeded.environmentId, {
        tokenId: expired.token.id,
        redeemedSessionId: redeemer.id,
        at: minutes(5),
      }),
    ).toBeNull();

    const revoked = newToken(seeded, issuing);
    await issueHandoffToken(database.db, seeded.environmentId, revoked.token);
    await revokeHandoffToken(database.db, seeded.environmentId, revoked.token.id, { at: NOW });
    expect(
      await markHandoffTokenRedeemed(database.db, seeded.environmentId, {
        tokenId: revoked.token.id,
        redeemedSessionId: redeemer.id,
        at: minutes(1),
      }),
    ).toBeNull();
  });

  it('records a decline as a revocation with its time', async () => {
    const seeded = await seedInquiry();
    const { token } = newToken(seeded, await desktop(seeded));
    await issueHandoffToken(database.db, seeded.environmentId, token);

    expect(
      await revokeHandoffToken(database.db, seeded.environmentId, token.id, {
        at: minutes(1),
        declined: true,
      }),
    ).toMatchObject({ revokedAt: minutes(1), declinedAt: minutes(1) });
    expect(
      await revokeHandoffToken(database.db, seeded.environmentId, token.id, {
        at: minutes(2),
        declined: true,
      }),
    ).toBeNull();
  });

  it('counts wrong codes one by one', async () => {
    const seeded = await seedInquiry();
    const { token } = newToken(seeded, await desktop(seeded), {
      confirmationCodeHash: digest('code'),
    });
    await issueHandoffToken(database.db, seeded.environmentId, token);

    expect(await recordHandoffCodeAttempt(database.db, seeded.environmentId, token.id)).toBe(1);
    expect(await recordHandoffCodeAttempt(database.db, seeded.environmentId, token.id)).toBe(2);
  });

  it('answers the newest token of a step, in any state', async () => {
    const seeded = await seedInquiry();
    const issuing = await desktop(seeded);
    const first = newToken(seeded, issuing);
    const second = newToken(seeded, issuing, { at: minutes(1) });
    await issueHandoffToken(database.db, seeded.environmentId, first.token);
    await issueHandoffToken(database.db, seeded.environmentId, second.token);

    expect(
      await latestHandoffToken(database.db, seeded.environmentId, {
        inquiryId: seeded.inquiryId,
        stepId: 'device_handoff',
      }),
    ).toMatchObject({ id: second.token.id });
    expect(
      await latestHandoffToken(database.db, seeded.environmentId, {
        inquiryId: seeded.inquiryId,
        stepId: 'other_step',
      }),
    ).toBeNull();
  });
});

describe('the state of a handoff step, per inquiry and step (V05)', () => {
  it('records a state, then moves it', async () => {
    const seeded = await seedInquiry();
    const step = { inquiryId: seeded.inquiryId, stepId: 'device_handoff' };

    expect(
      await listInquiryHandoffSteps(database.db, seeded.environmentId, seeded.inquiryId),
    ).toEqual([]);
    await setInquiryHandoffStepState(database.db, seeded.environmentId, {
      ...step,
      state: 'issued',
      at: NOW,
    });
    const moved = await setInquiryHandoffStepState(database.db, seeded.environmentId, {
      ...step,
      state: 'redeemed',
      at: minutes(1),
    });

    expect(moved).toMatchObject({ stepId: 'device_handoff', state: 'redeemed' });
    expect(
      await listInquiryHandoffSteps(database.db, seeded.environmentId, seeded.inquiryId),
    ).toEqual([expect.objectContaining({ stepId: 'device_handoff', state: 'redeemed' })]);
  });
});

describe('the phone’s session (C96.3, C96.4, F13)', () => {
  it('carries its three handoff fields together', async () => {
    const seeded = await seedInquiry();
    const issuing = await desktop(seeded);

    const created = await phone(seeded, issuing);

    expect(created).toMatchObject({
      status: 'active',
      deviceHandoffMethod: 'qr',
      handoffFromSessionId: issuing,
      handoffRedeemedAt: NOW,
      handoffRejectedAt: null,
    });
  });

  it('is the issuing session’s active handoff until it ends, expires or is rejected', async () => {
    const seeded = await seedInquiry();
    const issuing = await desktop(seeded);
    const created = await phone(seeded, issuing, minutes(30));

    expect(
      await findActiveHandoffSession(database.db, seeded.environmentId, issuing, NOW),
    ).toMatchObject({ id: created.id });
    expect(
      await findActiveHandoffSession(database.db, seeded.environmentId, issuing, minutes(30)),
    ).toBeNull();
    expect(
      await findActiveHandoffSession(database.db, seeded.environmentId, created.id, NOW),
    ).toBeNull();

    await rejectHandoffSession(database.db, seeded.environmentId, created.id, minutes(1));
    expect(
      await findActiveHandoffSession(database.db, seeded.environmentId, issuing, minutes(2)),
    ).toBeNull();
  });

  it('is rejected once: canceled while active, and only a session a handoff created', async () => {
    const seeded = await seedInquiry();
    const issuing = await desktop(seeded);
    const created = await phone(seeded, issuing);

    const rejected = await rejectHandoffSession(
      database.db,
      seeded.environmentId,
      created.id,
      minutes(1),
    );
    expect(rejected).toMatchObject({
      canceled: true,
      session: { status: 'canceled', handoffRejectedAt: minutes(1), canceledAt: minutes(1) },
    });
    expect(
      await rejectHandoffSession(database.db, seeded.environmentId, created.id, minutes(2)),
    ).toBeNull();
    expect(
      await rejectHandoffSession(database.db, seeded.environmentId, issuing, minutes(2)),
    ).toBeNull();
  });

  it('marks an ended phone session rejected without canceling it again', async () => {
    const seeded = await seedInquiry();
    const issuing = await desktop(seeded);
    const created = await phone(seeded, issuing);
    await rejectHandoffSession(database.db, seeded.environmentId, created.id, minutes(1));
    const later = await phone(seeded, issuing);
    await database.db.execute(
      sql`update inquiry_sessions set status = 'expired', expired_at = now(), revoked_at = now()
        where id = ${later.id}`,
    );

    const rejected = await rejectHandoffSession(
      database.db,
      seeded.environmentId,
      later.id,
      minutes(3),
    );

    expect(rejected).toMatchObject({
      canceled: false,
      session: { status: 'expired', handoffRejectedAt: minutes(3) },
    });
  });

  it('records the distance facts', async () => {
    const seeded = await seedInquiry();
    const created = await phone(seeded, await desktop(seeded));

    await recordHandoffDistanceFacts(database.db, seeded.environmentId, created.id, {
      distanceMeters: 1200,
      countryChanged: false,
      asnChanged: null,
    });

    expect(await getInquirySession(database.db, seeded.environmentId, created.id)).toMatchObject({
      handoffDistanceMeters: 1200,
      handoffCountryChanged: false,
      handoffAsnChanged: null,
    });
  });
});

describe('the verifications of a rejected handoff (V02)', () => {
  it('are marked, and the inquiry then has some', async () => {
    const seeded = await seedInquiry();
    const verification = await createVerification(database.db, seeded.environmentId, {
      id: testId('ver'),
      inquiryId: seeded.inquiryId,
      type: 'government_id',
    });

    expect(
      await hasRejectedHandoffVerifications(database.db, seeded.environmentId, seeded.inquiryId),
    ).toBe(false);
    expect(
      await markVerificationsFromRejectedHandoff(database.db, seeded.environmentId, [
        verification.id,
      ]),
    ).toEqual([verification.id]);
    expect(
      await markVerificationsFromRejectedHandoff(database.db, seeded.environmentId, []),
    ).toEqual([]);

    expect(await getVerification(database.db, seeded.environmentId, verification.id)).toMatchObject(
      { fromRejectedHandoff: true },
    );
    expect(
      await hasRejectedHandoffVerifications(database.db, seeded.environmentId, seeded.inquiryId),
    ).toBe(true);
  });
});

describe('hasConfirmedOtpDestination (C96.3, P02)', () => {
  it('is true only for a destination the inquiry confirmed by code, on its channel', async () => {
    const seeded = await seedInquiry();
    const verification = await createVerification(database.db, seeded.environmentId, {
      id: testId('ver'),
      inquiryId: seeded.inquiryId,
      type: 'email_address',
    });
    const index = (destination: string) =>
      otpDestinationIndex(BLIND_INDEX_KEY, {
        environmentId: seeded.environmentId,
        channel: 'email',
        destination,
      });
    const challengeId = testId('otpc');
    await insertOtpChallenge(database.db, seeded.environmentId, {
      id: challengeId,
      verificationId: verification.id,
      inquiryId: seeded.inquiryId,
      channel: 'email',
      destination: 'person@example.com',
      destinationIndex: index('person@example.com'),
      codeHmac: new Uint8Array(32),
      codeKeyId: 'kek-1',
      provider: 'smtp',
      sentAt: NOW,
      expiresAt: minutes(10),
    });
    const ask = (destination: string, channel: 'email' | 'sms' = 'email') =>
      hasConfirmedOtpDestination(database.db, seeded.environmentId, {
        inquiryId: seeded.inquiryId,
        channel,
        destinationIndex: index(destination),
      });

    expect(await ask('person@example.com')).toBe(false);
    await confirmOtpChallenge(database.db, seeded.environmentId, challengeId, minutes(1));

    expect(await ask('person@example.com')).toBe(true);
    expect(await ask('person@example.com', 'sms')).toBe(false);
    expect(await ask('other@example.com')).toBe(false);
  });
});
