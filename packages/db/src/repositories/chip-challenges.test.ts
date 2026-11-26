/**
 * C62.5, C53.3: the writes of the chip challenges (`api-nfc`): a new `initiated` challenge that
 * stores only its nonce's SHA-256, the count the challenge cap reads, the supersede (or expiry)
 * of the open one, the single-use consumption by a conditional update that also checks the
 * echoed nonce, with the AA response (and the nonce it answers) and the device report sealed, and
 * `processed` after the job with that evidence cleared. Every value is synthetic.
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
import {
  consumeChipChallenge,
  countChipChallenges,
  createChipChallenge,
  createVerification,
  getChipChallenge,
  listChipChallenges,
  markChipChallengeProcessed,
  openChipChallengeEvidence,
  openChipChallengeSubmission,
  redactChipChallenges,
  supersedeOpenChipChallenges,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-23T08:00:00.000Z');
const TTL_MS = 300_000;
const NONCE = '0123456789abcdef';
const OTHER_NONCE = 'fedcba9876543210';
const AA_RESPONSE = Buffer.from('synthetic active authentication response').toString('base64');
const DEVICE_REPORT = JSON.stringify({ 'read-ms': 1200 });

const nonceSha256 = (nonce: string) =>
  createHash('sha256').update(Buffer.from(nonce, 'hex')).digest('hex');

/** A tenant, an inquiry and `count` NFC verifications of it. */
async function chips(count = 1) {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const verification = await createVerification(database.db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'government_id_nfc',
    });
    ids.push(verification.id);
  }
  return { env: environment.id, inquiryId: inquiry.id, ids };
}

function newChallenge(
  verificationId: string,
  inquiryId: string,
  overrides: { createdAt?: Date; nonce?: string } = {},
) {
  const createdAt = overrides.createdAt ?? AT;
  return {
    id: testId('chc'),
    verificationId,
    inquiryId,
    nonceSha256: nonceSha256(overrides.nonce ?? NONCE),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + TTL_MS),
  };
}

const SUBMISSION = { nonce: NONCE, aaResponse: AA_RESPONSE, deviceReport: DEVICE_REPORT };

describe('createChipChallenge (C62.5)', () => {
  it('writes an initiated challenge holding only the nonce SHA-256', async () => {
    const { env, inquiryId, ids } = await chips();
    const input = newChallenge(ids[0] ?? '', inquiryId);

    const created = await createChipChallenge(database.db, env, input);

    expect(created).toEqual({
      id: input.id,
      environmentId: env,
      verificationId: ids[0],
      inquiryId,
      nonceSha256: input.nonceSha256,
      status: 'initiated',
      createdAt: AT,
      expiresAt: input.expiresAt,
      submittedAt: null,
      redactedAt: null,
      // Workflow 10C (C208.1): no sandbox chip was built for it.
      sandboxScenario: null,
    });
    const rows = await database.db.execute(
      sql`select * from chip_challenges where id = ${input.id}`,
    );
    expect(JSON.stringify(rows.rows)).not.toContain(NONCE);
    expect(await openChipChallengeSubmission(database.db, env, input.id)).toEqual({
      nonce: null,
      aaResponse: null,
      deviceReport: null,
    });
  });

  it('allows one initiated challenge per verification', async () => {
    const { env, inquiryId, ids } = await chips();
    await createChipChallenge(database.db, env, newChallenge(ids[0] ?? '', inquiryId));

    await expect(
      createChipChallenge(database.db, env, newChallenge(ids[0] ?? '', inquiryId)),
    ).rejects.toThrow();
  });
});

describe('countChipChallenges (C62.5)', () => {
  it('counts every challenge of the verification, whatever its status', async () => {
    const { env, inquiryId, ids } = await chips(2);
    const [first = '', second = ''] = ids;
    await createChipChallenge(database.db, env, newChallenge(first, inquiryId));
    await supersedeOpenChipChallenges(database.db, env, first);
    await createChipChallenge(database.db, env, newChallenge(first, inquiryId));
    await createChipChallenge(database.db, env, newChallenge(second, inquiryId));

    expect(await countChipChallenges(database.db, env, first)).toBe(2);
    expect(await countChipChallenges(database.db, env, second)).toBe(1);
    expect(await countChipChallenges(database.db, testId('env'), first)).toBe(0);
  });
});

describe('supersedeOpenChipChallenges (C62.5)', () => {
  it('supersedes the open challenge, or expires it past its expiry', async () => {
    const { env, inquiryId, ids } = await chips(2);
    const [fresh = '', stale = ''] = ids;
    const open = await createChipChallenge(database.db, env, newChallenge(fresh, inquiryId));
    const old = await createChipChallenge(database.db, env, newChallenge(stale, inquiryId));

    const superseded = await supersedeOpenChipChallenges(database.db, env, fresh, {
      now: new Date(AT.getTime() + 1_000),
    });
    const expired = await supersedeOpenChipChallenges(database.db, env, stale, {
      now: new Date(AT.getTime() + TTL_MS),
    });

    expect(superseded.map((challenge) => [challenge.id, challenge.status])).toEqual([
      [open.id, 'superseded'],
    ]);
    expect(expired.map((challenge) => [challenge.id, challenge.status])).toEqual([
      [old.id, 'expired'],
    ]);
    expect(await supersedeOpenChipChallenges(database.db, env, fresh)).toEqual([]);
  });

  it('always supersedes without a now, and leaves a consumed challenge as it is', async () => {
    const { env, inquiryId, ids } = await chips();
    const [verificationId = ''] = ids;
    const consumed = await createChipChallenge(
      database.db,
      env,
      newChallenge(verificationId, inquiryId),
    );
    await consumeChipChallenge(database.db, env, {
      id: consumed.id,
      verificationId,
      nonceSha256: consumed.nonceSha256,
      now: AT,
      submission: SUBMISSION,
    });

    expect(await supersedeOpenChipChallenges(database.db, env, verificationId)).toEqual([]);
    expect((await getChipChallenge(database.db, env, consumed.id))?.status).toBe('submitted');
  });
});

describe('consumeChipChallenge (C62.5)', () => {
  it('consumes the challenge once, sealing the AA response with its nonce and the report', async () => {
    const { env, inquiryId, ids } = await chips();
    const [verificationId = ''] = ids;
    const challenge = await createChipChallenge(
      database.db,
      env,
      newChallenge(verificationId, inquiryId),
    );
    const now = new Date(AT.getTime() + 60_000);

    const consumed = await consumeChipChallenge(database.db, env, {
      id: challenge.id,
      verificationId,
      nonceSha256: nonceSha256(NONCE),
      now,
      submission: SUBMISSION,
    });

    expect(consumed).toMatchObject({ id: challenge.id, status: 'submitted', submittedAt: now });
    expect(await openChipChallengeSubmission(database.db, env, challenge.id)).toEqual({
      nonce: NONCE,
      aaResponse: AA_RESPONSE,
      deviceReport: DEVICE_REPORT,
    });
    // The reads written before the writes see the response alone, as the client sent it.
    expect(await openChipChallengeEvidence(database.db, env, challenge.id)).toEqual({
      aaResponse: AA_RESPONSE,
      deviceReport: DEVICE_REPORT,
    });
    const rows = await database.db.execute(
      sql`select aa_response::text as aa, device_report::text as report from chip_challenges where id = ${challenge.id}`,
    );
    expect(JSON.stringify(rows.rows)).not.toContain(AA_RESPONSE);
    expect(JSON.stringify(rows.rows)).not.toContain('read-ms');
    expect(
      await consumeChipChallenge(database.db, env, {
        id: challenge.id,
        verificationId,
        nonceSha256: nonceSha256(NONCE),
        now,
        submission: SUBMISSION,
      }),
    ).toBeNull();
  });

  it('stores nothing for an absent response or report', async () => {
    const { env, inquiryId, ids } = await chips();
    const [verificationId = ''] = ids;
    const challenge = await createChipChallenge(
      database.db,
      env,
      newChallenge(verificationId, inquiryId),
    );

    await consumeChipChallenge(database.db, env, {
      id: challenge.id,
      verificationId,
      nonceSha256: nonceSha256(NONCE),
      now: AT,
      submission: { nonce: NONCE, aaResponse: null, deviceReport: null },
    });

    expect(await openChipChallengeSubmission(database.db, env, challenge.id)).toEqual({
      nonce: null,
      aaResponse: null,
      deviceReport: null,
    });
  });

  it('matches nothing for another nonce, verification, environment, an expired, superseded or redacted challenge', async () => {
    const { env, inquiryId, ids } = await chips(5);
    const [own = '', other = '', expiring = '', superseding = '', redacting = ''] = ids;
    const challenge = await createChipChallenge(database.db, env, newChallenge(own, inquiryId));
    const consume = (input: {
      id: string;
      verificationId: string;
      nonce?: string;
      now?: Date;
      environmentId?: string;
    }) =>
      consumeChipChallenge(database.db, input.environmentId ?? env, {
        id: input.id,
        verificationId: input.verificationId,
        nonceSha256: nonceSha256(input.nonce ?? NONCE),
        now: input.now ?? AT,
        submission: SUBMISSION,
      });

    expect(await consume({ id: challenge.id, verificationId: own, nonce: OTHER_NONCE })).toBeNull();
    expect(await consume({ id: challenge.id, verificationId: other })).toBeNull();
    expect(
      await consume({ id: challenge.id, verificationId: own, environmentId: testId('env') }),
    ).toBeNull();

    const expired = await createChipChallenge(database.db, env, newChallenge(expiring, inquiryId));
    expect(
      await consume({
        id: expired.id,
        verificationId: expiring,
        now: new Date(AT.getTime() + TTL_MS),
      }),
    ).toBeNull();

    const superseded = await createChipChallenge(
      database.db,
      env,
      newChallenge(superseding, inquiryId),
    );
    await supersedeOpenChipChallenges(database.db, env, superseding);
    expect(await consume({ id: superseded.id, verificationId: superseding })).toBeNull();

    const redacted = await createChipChallenge(
      database.db,
      env,
      newChallenge(redacting, inquiryId),
    );
    await redactChipChallenges(database.db, env, [redacting], AT);
    expect(await consume({ id: redacted.id, verificationId: redacting })).toBeNull();

    expect(await consume({ id: testId('chc'), verificationId: own })).toBeNull();
    expect((await getChipChallenge(database.db, env, challenge.id))?.status).toBe('initiated');
  });
});

describe('markChipChallengeProcessed (C62.5, decision 43)', () => {
  it('moves a submitted challenge to processed and clears its AA response and report', async () => {
    const { env, inquiryId, ids } = await chips(2);
    const [verificationId = '', open = ''] = ids;
    const challenge = await createChipChallenge(
      database.db,
      env,
      newChallenge(verificationId, inquiryId),
    );
    await consumeChipChallenge(database.db, env, {
      id: challenge.id,
      verificationId,
      nonceSha256: nonceSha256(NONCE),
      now: AT,
      submission: SUBMISSION,
    });

    const processed = await markChipChallengeProcessed(database.db, env, challenge.id);

    expect(processed).toMatchObject({ id: challenge.id, status: 'processed' });
    expect(await openChipChallengeSubmission(database.db, env, challenge.id)).toEqual({
      nonce: null,
      aaResponse: null,
      deviceReport: null,
    });
    expect(await markChipChallengeProcessed(database.db, env, challenge.id)).toBeNull();

    const initiated = await createChipChallenge(database.db, env, newChallenge(open, inquiryId));
    expect(await markChipChallengeProcessed(database.db, env, initiated.id)).toBeNull();
    expect((await listChipChallenges(database.db, env, open)).map((c) => c.status)).toEqual([
      'initiated',
    ]);
  });
});

describe('openChipChallengeSubmission', () => {
  it('is null for an unknown challenge or another environment', async () => {
    const { env } = await chips();

    expect(await openChipChallengeSubmission(database.db, env, testId('chc'))).toBeNull();
  });
});
