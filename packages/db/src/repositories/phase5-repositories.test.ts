/**
 * C54.4: the Workflow 5A repository reads other agents use (the jobs, the attributes, the inquiry
 * settlement), redaction (C53.6) and the blind-index rebuild (C53.4). Rows are written with the
 * `@openverify/db/testing` seeders, as their owners' write functions will write them. Every value
 * is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cryptoAddressIndex, otpDestinationIndex } from '../blind-index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCryptoChallenge,
  seedOtpChallenge,
  seedOtpVerificationState,
  seedVerificationInputs,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createVerification,
  getCryptoChallenge,
  getOtpChallenge,
  getOtpVerificationState,
  getSentOtpChallenge,
  getSubmittedCryptoChallenge,
  getVerificationInputs,
  listCryptoChallenges,
  listOtpChallenges,
  listVerificationInputSources,
  openCryptoChallengeEvidence,
  openOtpChallengeDestination,
  rebuildCryptoAddressIndexes,
  rebuildOtpDestinationIndexes,
  redactCryptoChallenges,
  redactOtpChallenges,
  redactVerificationInputs,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-10-22T08:00:00.000Z');
const LATER = new Date('2026-10-22T08:05:00.000Z');
const KEY = new Uint8Array(32).fill(9);
const OTHER_KEY = new Uint8Array(32).fill(4);

async function inquiryWith(
  ...types: ('aamva' | 'database' | 'government_id' | 'phone_number' | 'crypto_wallet')[]
) {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const ids: string[] = [];
  for (const type of types) {
    const verification = await createVerification(database.db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type,
    });
    ids.push(verification.id);
  }
  return { env: environment.id, inquiryId: inquiry.id, ids };
}

describe('verification inputs (C52.3, C59.6)', () => {
  it('opens a verification’s values, with the field names, source and source verification', async () => {
    const { env, inquiryId, ids } = await inquiryWith('government_id', 'aamva');
    const [governmentId = '', aamva = ''] = ids;
    await seedVerificationInputs(database.db, env, {
      verificationId: aamva,
      inquiryId,
      values: { 'name-last': 'Synthetic', birthdate: '1990-01-31' },
      source: 'government_id',
      sourceVerificationId: governmentId,
      at: AT,
    });

    expect(await getVerificationInputs(database.db, env, aamva)).toEqual({
      environmentId: env,
      verificationId: aamva,
      inquiryId,
      values: { 'name-last': 'Synthetic', birthdate: '1990-01-31' },
      fieldNames: ['name-last', 'birthdate'],
      source: 'government_id',
      sourceVerificationId: governmentId,
      createdAt: AT,
      updatedAt: AT,
      redactedAt: null,
    });
    expect(await getVerificationInputs(database.db, env, governmentId)).toBeNull();
    const elsewhere = await inquiryWith();
    expect(await getVerificationInputs(database.db, elsewhere.env, aamva)).toBeNull();
  });

  it('lists the source verification of each verification that has inputs (C50.5)', async () => {
    const { env, inquiryId, ids } = await inquiryWith('government_id', 'aamva', 'database');
    const [governmentId = '', aamva = '', databaseId = ''] = ids;
    await seedVerificationInputs(database.db, env, {
      verificationId: aamva,
      inquiryId,
      values: {},
      source: 'government_id',
      sourceVerificationId: governmentId,
    });
    await seedVerificationInputs(database.db, env, {
      verificationId: databaseId,
      inquiryId,
      values: { 'name-first': 'Avery' },
    });

    const sources = await listVerificationInputSources(database.db, env, ids);

    expect([...sources.entries()].sort()).toEqual(
      [
        [aamva, governmentId],
        [databaseId, null],
      ].sort(),
    );
    expect((await listVerificationInputSources(database.db, env, [])).size).toBe(0);
  });

  it('redacts the values and keeps the names and the source (C53.6)', async () => {
    const { env, inquiryId, ids } = await inquiryWith('database');
    const [verificationId = ''] = ids;
    await seedVerificationInputs(database.db, env, {
      verificationId,
      inquiryId,
      values: { 'name-first': 'Avery' },
    });

    expect(await redactVerificationInputs(database.db, env, [verificationId], AT)).toBe(1);
    expect(await redactVerificationInputs(database.db, env, [verificationId], LATER)).toBe(1);

    expect(await getVerificationInputs(database.db, env, verificationId)).toMatchObject({
      values: null,
      fieldNames: ['name-first'],
      source: 'flow',
      redactedAt: AT,
    });
    expect(await redactVerificationInputs(database.db, env, [], AT)).toBe(0);
  });
});

describe('OTP challenges and states (C55)', () => {
  it('reads challenges newest first, the sent one, and opens a destination', async () => {
    const { env, inquiryId, ids } = await inquiryWith('phone_number');
    const [verificationId = ''] = ids;
    const old = await seedOtpChallenge(database.db, env, {
      verificationId,
      inquiryId,
      channel: 'sms',
      destination: '+15550100003',
      status: 'superseded',
      codeHmac: null,
      sentAt: AT,
    });
    const sent = await seedOtpChallenge(database.db, env, {
      verificationId,
      inquiryId,
      channel: 'sms',
      destination: '+15550100004',
      destinationIndex: 'a'.repeat(64),
      codeKeyId: 'kid-synthetic',
      provider: 'sandbox',
      providerMessageId: 'msg-synthetic-1',
      failedAttempts: 2,
      sentAt: LATER,
    });

    expect((await listOtpChallenges(database.db, env, verificationId)).map((c) => c.id)).toEqual([
      sent,
      old,
    ]);
    expect(await getSentOtpChallenge(database.db, env, verificationId)).toEqual({
      id: sent,
      environmentId: env,
      verificationId,
      inquiryId,
      channel: 'sms',
      status: 'sent',
      failedAttempts: 2,
      codeKeyId: 'kid-synthetic',
      provider: 'sandbox',
      providerMessageId: 'msg-synthetic-1',
      sentAt: LATER,
      expiresAt: new Date(LATER.getTime() + 600_000),
      confirmedAt: null,
      errorCode: null,
      destinationIndex: 'a'.repeat(64),
      hasDestination: true,
      redactedAt: null,
    });
    expect(await getOtpChallenge(database.db, env, old)).toMatchObject({ status: 'superseded' });
    expect(await openOtpChallengeDestination(database.db, env, sent)).toBe('+15550100004');
    const elsewhere = await inquiryWith();
    expect(await getOtpChallenge(database.db, elsewhere.env, sent)).toBeNull();
    expect(await openOtpChallengeDestination(database.db, elsewhere.env, sent)).toBeNull();
    expect(await getSentOtpChallenge(database.db, elsewhere.env, verificationId)).toBeNull();
  });

  it('redacts the destination, its index, the code HMAC and the message id (C53.5, C53.6)', async () => {
    const { env, inquiryId, ids } = await inquiryWith('phone_number');
    const [verificationId = ''] = ids;
    const id = await seedOtpChallenge(database.db, env, {
      verificationId,
      inquiryId,
      channel: 'sms',
      destination: '+15550100005',
      destinationIndex: 'b'.repeat(64),
      providerMessageId: 'msg-synthetic-2',
    });

    expect(await redactOtpChallenges(database.db, env, [verificationId], AT)).toBe(1);

    expect(await getOtpChallenge(database.db, env, id)).toMatchObject({
      destinationIndex: null,
      hasDestination: false,
      providerMessageId: null,
      redactedAt: AT,
    });
    expect(await openOtpChallengeDestination(database.db, env, id)).toBeNull();
    const hmac = await database.client.query<{ code_hmac: unknown }>(
      `select code_hmac from otp_challenges where id = $1`,
      [id],
    );
    expect(hmac.rows[0]?.code_hmac).toBeNull();
  });

  it('rebuilds every unredacted destination index under the new key (C53.4)', async () => {
    const { env, inquiryId, ids } = await inquiryWith('phone_number');
    const [verificationId = ''] = ids;
    const id = await seedOtpChallenge(database.db, env, {
      verificationId,
      inquiryId,
      channel: 'email',
      destination: 'Avery@Example.TEST',
      destinationIndex: otpDestinationIndex(OTHER_KEY, {
        environmentId: env,
        channel: 'email',
        destination: 'Avery@Example.TEST',
      }),
      status: 'confirmed',
      codeHmac: null,
    });

    const result = await rebuildOtpDestinationIndexes(database.db, KEY, { batchSize: 1 });

    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect((await getOtpChallenge(database.db, env, id))?.destinationIndex).toBe(
      otpDestinationIndex(KEY, {
        environmentId: env,
        channel: 'email',
        destination: 'avery@example.test',
      }),
    );
    expect((await rebuildOtpDestinationIndexes(database.db, KEY)).updated).toBe(0);
  });

  it('reads a verification’s OTP state', async () => {
    const { env, inquiryId, ids } = await inquiryWith('phone_number');
    const [verificationId = ''] = ids;
    await seedOtpVerificationState(database.db, env, {
      verificationId,
      inquiryId,
      sends: 3,
      wrongEntries: 4,
      limitedAt: AT,
      limitedReason: 'destination',
    });

    expect(await getOtpVerificationState(database.db, env, verificationId)).toMatchObject({
      environmentId: env,
      verificationId,
      inquiryId,
      sends: 3,
      wrongEntries: 4,
      limitedAt: AT,
      limitedReason: 'destination',
    });
    const elsewhere = await inquiryWith();
    expect(await getOtpVerificationState(database.db, elsewhere.env, verificationId)).toBeNull();
  });
});

describe('crypto challenges (C57)', () => {
  it('reads challenges newest first, the submitted one, and opens its evidence', async () => {
    const { env, inquiryId, ids } = await inquiryWith('crypto_wallet');
    const [verificationId = ''] = ids;
    const base = {
      verificationId,
      inquiryId,
      chainId: 'eip155:1',
      walletAddress: '0x00000000000000000000000000000000000000bb',
      message: 'synthetic challenge one',
    };
    const old = await seedCryptoChallenge(database.db, env, {
      ...base,
      status: 'superseded',
      createdAt: AT,
    });
    const submitted = await seedCryptoChallenge(database.db, env, {
      ...base,
      message: 'synthetic challenge two',
      status: 'submitted',
      signature: '0xsynthetic-signature',
      scheme: 'eip191',
      createdAt: LATER,
      submittedAt: LATER,
    });

    expect((await listCryptoChallenges(database.db, env, verificationId)).map((c) => c.id)).toEqual(
      [submitted, old],
    );
    expect(await getSubmittedCryptoChallenge(database.db, env, verificationId)).toMatchObject({
      id: submitted,
      chainId: 'eip155:1',
      status: 'submitted',
      scheme: 'eip191',
      submittedAt: LATER,
    });
    expect(await openCryptoChallengeEvidence(database.db, env, submitted)).toEqual({
      walletAddress: '0x00000000000000000000000000000000000000bb',
      message: 'synthetic challenge two',
      signature: '0xsynthetic-signature',
      signedMessage: null,
    });
    expect(await getCryptoChallenge(database.db, env, old)).toMatchObject({ status: 'superseded' });
    const elsewhere = await inquiryWith();
    expect(await getCryptoChallenge(database.db, elsewhere.env, old)).toBeNull();
    expect(await openCryptoChallengeEvidence(database.db, elsewhere.env, old)).toBeNull();
    expect(
      await getSubmittedCryptoChallenge(database.db, elsewhere.env, verificationId),
    ).toBeNull();
  });

  it('redacts every sealed value and the index (C53.6), then rebuilds only unredacted indexes', async () => {
    const { env, inquiryId, ids } = await inquiryWith('crypto_wallet', 'crypto_wallet');
    const [redacted = '', kept = ''] = ids;
    const address = 'bc1qsyntheticaddress0000000000000000000000';
    const gone = await seedCryptoChallenge(database.db, env, {
      verificationId: redacted,
      inquiryId,
      chainId: 'bip122:000000000019d6689c085ae165831e93',
      walletAddress: address,
      addressIndex: 'c'.repeat(64),
      message: 'synthetic',
      status: 'submitted',
      signature: 'synthetic-signature',
      signedMessage: 'synthetic signed',
    });
    const live = await seedCryptoChallenge(database.db, env, {
      verificationId: kept,
      inquiryId,
      chainId: 'bip122:000000000019d6689c085ae165831e93',
      walletAddress: address,
      addressIndex: cryptoAddressIndex(OTHER_KEY, { environmentId: env, address }),
      message: 'synthetic',
    });

    expect(await redactCryptoChallenges(database.db, env, [redacted], AT)).toBe(1);
    expect(await openCryptoChallengeEvidence(database.db, env, gone)).toEqual({
      walletAddress: null,
      message: null,
      signature: null,
      signedMessage: null,
    });
    expect(await getCryptoChallenge(database.db, env, gone)).toMatchObject({
      addressIndex: null,
      redactedAt: AT,
    });

    await rebuildCryptoAddressIndexes(database.db, KEY, { batchSize: 1 });

    expect((await getCryptoChallenge(database.db, env, live))?.addressIndex).toBe(
      cryptoAddressIndex(KEY, { environmentId: env, address }),
    );
    expect((await getCryptoChallenge(database.db, env, gone))?.addressIndex).toBeNull();
  });
});
