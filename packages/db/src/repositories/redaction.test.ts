/**
 * C16 redaction helpers: every table that stores a copy of an inquiry's or account's PII is
 * seeded, redacted, and checked for any remaining trace of the subject.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptBytes } from '../crypto.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCryptoChallenge,
  seedOtpChallenge,
  seedVerificationInputs,
  seedBusinessRegistryRecord,
  seedChipChallenge,
  seedChipRead,
  seedDocumentExtraction,
  seedDevice,
  seedNetwork,
  seedSessionSignalBody,
  testId,
  type TestDatabase,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  consolidateAccounts,
  createAccount,
  forgetReportCopies,
  createApiLog,
  createEvent,
  createFile,
  createInquirySession,
  createVerification,
  getAccount,
  getApiLog,
  getEvent,
  getFile,
  getInquiry,
  getInquirySession,
  getChipRead,
  getCryptoChallenge,
  getLatestInquiryConsent,
  getOtpChallenge,
  getVerification,
  getVerificationInputs,
  openBusinessRegistryRecord,
  openChipChallengeEvidence,
  openChipReadEvidence,
  openCryptoChallengeEvidence,
  openDocumentExtractionFields,
  openOtpChallengeDestination,
  markFilesDeleted,
  markInquirySessionStarted,
  moveInquiriesToAccount,
  recordInquirySessionConsent,
  redactAccountRecords,
  redactInquiryRecords,
  replaceVerificationChecks,
  updateInquiry,
} from './index.js';
import * as repositories from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const SUBJECT = 'Jane Synthetic-Subject';
const AT = new Date('2026-12-01T00:00:00.000Z');

async function seedInquiry() {
  const { environment } = await createTestTenant(database.db);
  const env = environment.id;
  const { inquiry } = await createTestInquiry(database.db, env, {
    fields: { 'name-full': SUBJECT },
  });
  await updateInquiry(database.db, env, inquiry.id, { note: `note about ${SUBJECT}` });
  const session = await createInquirySession(database.db, env, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await markInquirySessionStarted(database.db, env, session.id, {
    ip: '203.0.113.44',
    userAgent: SUBJECT,
  });
  await recordInquirySessionConsent(database.db, env, session.id, {
    acceptedAt: AT,
    textKeys: ['consent.biometric'],
    locale: 'en',
    ip: '203.0.113.44',
    userAgent: SUBJECT,
  });
  const verification = await createVerification(database.db, env, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await replaceVerificationChecks(database.db, env, verification.id, [
    {
      name: 'id_glare_detection',
      status: 'failed',
      type: 'user_behavior',
      requirement: 'required',
      reasons: ['glare'],
      metadata: { glare_ratio: 0.4 },
    },
  ]);
  const fileId = testId('file');
  const bytes = Buffer.from(SUBJECT);
  const file = await createFile(database.db, env, {
    id: fileId,
    verificationId: verification.id,
    kind: 'front',
    storageKey: `${env}/${fileId}`,
    mimeType: 'image/png',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: encryptBytes(bytes, database.keyring, { context: fileId }).wrappedDek,
  });
  const inquiryEvent = await createEvent(database.db, env, {
    id: testId('evt'),
    name: 'inquiry.created',
    payload: {
      data: { type: 'inquiry', id: inquiry.id, attributes: { fields: { 'name-full': SUBJECT } } },
    },
  });
  const verificationEvent = await createEvent(database.db, env, {
    id: testId('evt'),
    name: 'verification.failed',
    payload: {
      data: {
        type: 'verification/government-id',
        id: verification.id,
        attributes: { note: SUBJECT },
      },
    },
  });
  const sessionEvent = await createEvent(database.db, env, {
    id: testId('evt'),
    name: 'inquiry-session.started',
    payload: {
      data: { type: 'inquiry-session', id: session.id, attributes: { 'user-agent': SUBJECT } },
    },
  });
  const unrelated = await createEvent(database.db, env, {
    id: testId('evt'),
    name: 'inquiry.created',
    payload: { data: { type: 'inquiry', id: testId('inq'), attributes: {} } },
  });
  const apiLog = await createApiLog(database.db, env, {
    id: testId('alog'),
    method: 'POST',
    path: '/api/v1/inquiries',
    route: '/api/v1/inquiries',
    status: 201,
    durationMs: 3,
    resourceId: inquiry.id,
    requestBody: { fields: { 'name-full': SUBJECT } },
    responseBody: { data: { attributes: { fields: { 'name-full': SUBJECT } } } },
    query: { q: SUBJECT },
  });
  const claim = await claimIdempotencyKey(database.db, env, {
    principalType: 'api_key',
    principalId: testId('key'),
    key: 'create-1',
    fingerprint: 'b'.repeat(64),
  });
  if (claim.outcome !== 'claimed') throw new Error(claim.outcome);
  await completeIdempotencyKey(database.db, env, claim.id, {
    status: 201,
    headers: {},
    body: JSON.stringify({ fields: { 'name-full': SUBJECT } }),
    resourceId: inquiry.id,
  });
  return {
    env,
    inquiry,
    session,
    verification,
    file,
    inquiryEvent,
    verificationEvent,
    sessionEvent,
    unrelated,
    apiLog,
  };
}

describe('redactInquiryRecords (C16)', () => {
  it('removes the subject from every table and stubs the event payloads', async () => {
    const seeded = await seedInquiry();
    const { env } = seeded;

    const result = await redactInquiryRecords(database.db, env, seeded.inquiry.id, { at: AT });

    expect(result).toMatchObject({ alreadyRedacted: false, stubbedEvents: 3 });
    expect(result?.files.map((file) => file.id)).toEqual([seeded.file.id]);
    expect(await getInquiry(database.db, env, seeded.inquiry.id)).toMatchObject({
      fields: {},
      note: null,
      redactedAt: AT,
    });
    expect(await getInquirySession(database.db, env, seeded.session.id)).toMatchObject({
      ip: null,
      userAgent: null,
    });
    expect(await getLatestInquiryConsent(database.db, env, seeded.inquiry.id)).toMatchObject({
      ip: null,
      userAgent: null,
      textKeys: ['consent.biometric'],
    });
    expect((await getVerification(database.db, env, seeded.verification.id))?.checks).toEqual([
      expect.objectContaining({ metadata: {}, reasons: [] }),
    ]);
    expect(await getEvent(database.db, env, seeded.inquiryEvent.id)).toMatchObject({
      redactedAt: AT,
      payload: {
        data: {
          type: 'inquiry',
          id: seeded.inquiry.id,
          attributes: { 'redacted-at': AT.toISOString() },
        },
      },
    });
    expect((await getEvent(database.db, env, seeded.unrelated.id))?.redactedAt).toBeNull();
    expect(await getApiLog(database.db, env, seeded.apiLog.id)).toMatchObject({
      requestBody: null,
      responseBody: null,
      query: null,
    });
    const leftovers = await database.db.execute(
      sql`select count(*)::int as count from idempotency_keys where resource_id = ${seeded.inquiry.id}`,
    );
    expect(leftovers.rows).toEqual([{ count: 0 }]);
  });

  it('clears API log and idempotent copies that mention it in a list or an embedding, whatever their resource id (2B F005, F017)', async () => {
    const seeded = await seedInquiry();
    const { env, inquiry } = seeded;
    const other = testId('inq');
    const resource = (id: string) => ({
      type: 'inquiry',
      id,
      attributes: { fields: { 'name-full': SUBJECT } },
    });
    const log = (path: string, resourceId: string | null, responseBody: unknown) =>
      createApiLog(database.db, env, {
        id: testId('alog'),
        method: 'GET',
        path,
        status: 200,
        durationMs: 2,
        resourceId,
        responseBody,
      });
    const listCall = await log('/api/v1/inquiries', null, {
      data: [resource(other), resource(inquiry.id)],
    });
    const eventId = testId('evt');
    const eventCall = await log(`/api/v1/events/${eventId}`, eventId, {
      data: { type: 'event', id: eventId, attributes: { payload: { data: resource(inquiry.id) } } },
    });
    const truncatedCall = await log('/api/v1/inquiries', null, {
      truncated: true,
      'byte-length': 200_000,
      preview: JSON.stringify({ data: [resource(inquiry.id)] }).slice(0, 120),
    });
    const bystander = await log('/api/v1/inquiries', null, { data: [resource(other)] });
    const keyFor = async (key: string, resourceId: string, body: unknown) => {
      const claim = await claimIdempotencyKey(database.db, env, {
        principalType: 'api_key',
        principalId: testId('key'),
        key,
        fingerprint: 'c'.repeat(64),
      });
      if (claim.outcome !== 'claimed') throw new Error(claim.outcome);
      await completeIdempotencyKey(database.db, env, claim.id, {
        status: 200,
        headers: {},
        body: JSON.stringify(body),
        resourceId,
      });
      return claim.id;
    };
    const embedding = await keyFor('embeds-1', testId('acc'), { included: [resource(inquiry.id)] });
    const unrelatedKey = await keyFor('other-1', other, { data: resource(other) });

    await redactInquiryRecords(database.db, env, inquiry.id, { at: AT });

    for (const copy of [listCall, eventCall, truncatedCall]) {
      expect(await getApiLog(database.db, env, copy.id), copy.path).toMatchObject({
        responseBody: null,
      });
    }
    expect((await getApiLog(database.db, env, bystander.id))?.responseBody).toEqual({
      data: [resource(other)],
    });
    const keys = await database.db.execute<{ id: number }>(
      sql`select id::int as id from idempotency_keys where id in (${embedding}, ${unrelatedKey})`,
    );
    expect(keys.rows).toEqual([{ id: unrelatedKey }]);
  });

  it('is idempotent, and keeps returning files until they are marked deleted', async () => {
    const { env, inquiry, file } = await seedInquiry();
    await redactInquiryRecords(database.db, env, inquiry.id, { at: AT });

    const again = await redactInquiryRecords(database.db, env, inquiry.id, { at: new Date() });
    expect(again).toMatchObject({ alreadyRedacted: true, inquiry: { redactedAt: AT } });
    expect(again?.files.map((entry) => entry.id)).toEqual([file.id]);

    expect(await markFilesDeleted(database.db, env, [file.id], AT)).toBe(1);
    expect(await markFilesDeleted(database.db, env, [file.id], AT)).toBe(0);
    expect(await markFilesDeleted(database.db, env, [], AT)).toBe(0);
    expect((await getFile(database.db, env, file.id))?.deletedAt).toEqual(AT);
    expect((await redactInquiryRecords(database.db, env, inquiry.id))?.files).toEqual([]);
  });

  it('clears the Workflow 5A inputs, OTP destinations and wallet evidence of its verifications (C53.6)', async () => {
    const { env, inquiry } = await seedInquiry();
    const ofType = async (type: 'database' | 'phone_number' | 'crypto_wallet') =>
      (
        await createVerification(database.db, env, {
          id: testId('ver'),
          inquiryId: inquiry.id,
          type,
        })
      ).id;
    const entered = await ofType('database');
    await seedVerificationInputs(database.db, env, {
      verificationId: entered,
      inquiryId: inquiry.id,
      values: { 'name-first': SUBJECT },
    });
    const otp = await seedOtpChallenge(database.db, env, {
      verificationId: await ofType('phone_number'),
      inquiryId: inquiry.id,
      channel: 'sms',
      destination: '+15550100011',
      destinationIndex: 'd'.repeat(64),
    });
    const challenge = await seedCryptoChallenge(database.db, env, {
      verificationId: await ofType('crypto_wallet'),
      inquiryId: inquiry.id,
      chainId: 'eip155:1',
      walletAddress: '0x00000000000000000000000000000000000000dd',
      addressIndex: 'e'.repeat(64),
      message: `challenge for ${SUBJECT}`,
    });

    await redactInquiryRecords(database.db, env, inquiry.id, { at: AT });

    expect(await getVerificationInputs(database.db, env, entered)).toMatchObject({
      values: null,
      redactedAt: AT,
    });
    expect(await openOtpChallengeDestination(database.db, env, otp)).toBeNull();
    expect(await getOtpChallenge(database.db, env, otp)).toMatchObject({
      destinationIndex: null,
      redactedAt: AT,
    });
    expect(await openCryptoChallengeEvidence(database.db, env, challenge)).toEqual({
      walletAddress: null,
      message: null,
      signature: null,
      signedMessage: null,
    });
    expect(await getCryptoChallenge(database.db, env, challenge)).toMatchObject({
      addressIndex: null,
      redactedAt: AT,
    });
    const raw = await database.client.query<{ row: string }>(
      `select row_to_json(t)::text as row from (
         select "values" from verification_inputs where inquiry_id = $1
         union all select destination from otp_challenges where inquiry_id = $1
         union all select message from crypto_challenges where inquiry_id = $1) t`,
      [inquiry.id],
    );
    expect(raw.rows.every((row) => row.row.includes('null'))).toBe(true);
  });

  it('clears the Workflow 5B extractions, chip evidence and registry records of its verifications (C53.6)', async () => {
    const { env, inquiry } = await seedInquiry();
    const ofType = async (type: 'document' | 'government_id_nfc' | 'database_business') =>
      (
        await createVerification(database.db, env, {
          id: testId('ver'),
          inquiryId: inquiry.id,
          type,
        })
      ).id;
    const documentId = await ofType('document');
    await seedDocumentExtraction(database.db, env, {
      verificationId: documentId,
      inquiryId: inquiry.id,
      fields: { name: SUBJECT },
    });
    const chipId = await ofType('government_id_nfc');
    const challenge = await seedChipChallenge(database.db, env, {
      verificationId: chipId,
      inquiryId: inquiry.id,
      status: 'submitted',
      aaResponse: Buffer.from(SUBJECT).toString('base64'),
      deviceReport: JSON.stringify({ note: SUBJECT }),
    });
    await seedChipRead(database.db, env, {
      verificationId: chipId,
      inquiryId: inquiry.id,
      fields: { 'name-last': SUBJECT },
      sodSignatureIndex: 'f'.repeat(64),
      documentNumberIndex: 'e'.repeat(64),
    });
    const businessId = await ofType('database_business');
    await seedBusinessRegistryRecord(database.db, env, {
      verificationId: businessId,
      inquiryId: inquiry.id,
      record: { recordId: 'SANDBOX0001', legalName: SUBJECT },
    });

    await redactInquiryRecords(database.db, env, inquiry.id, { at: AT });

    expect(await openDocumentExtractionFields(database.db, env, documentId)).toBeNull();
    expect(await openChipChallengeEvidence(database.db, env, challenge)).toEqual({
      aaResponse: null,
      deviceReport: null,
    });
    expect(await openChipReadEvidence(database.db, env, chipId)).toBeNull();
    expect(await getChipRead(database.db, env, chipId)).toMatchObject({
      sodSignatureIndex: null,
      documentNumberIndex: null,
      redactedAt: AT,
    });
    expect(await openBusinessRegistryRecord(database.db, env, businessId)).toBeNull();
    const raw = await database.client.query<{ row: string }>(
      `select row_to_json(t)::text as row from (
         select fields as v from document_extractions where inquiry_id = $1
         union all select aa_response from chip_challenges where inquiry_id = $1
         union all select device_report from chip_challenges where inquiry_id = $1
         union all select fields from chip_reads where inquiry_id = $1
         union all select sod_signature from chip_reads where inquiry_id = $1
         union all select record from business_registry_records where inquiry_id = $1) t`,
      [inquiry.id],
    );
    expect(raw.rows).toHaveLength(6);
    expect(raw.rows.every((row) => row.row.includes('null'))).toBe(true);
  });

  it('nulls the session location and the network address and location, keeping the derived facts, and stubs and forgets the network (C91.4, C107.5)', async () => {
    const seeded = await seedInquiry();
    const { env } = seeded;
    const network = await seedNetwork(database.db, env, {
      inquirySessionId: seeded.session.id,
      ip: '203.0.113.9',
      location: { regionCode: 'ZZ-2', regionName: 'Synthetic', latitude: -1.5, longitude: 20.5 },
      asn: 64_502,
      countryCode: 'ZZ',
      threatLevel: 'low',
    });
    const event = await createEvent(database.db, env, {
      id: testId('evt'),
      name: 'inquiry-session.started',
      objectId: network.id,
      payload: { included: [{ type: 'network', id: network.id }] },
    });
    const copy = await createApiLog(database.db, env, {
      id: testId('alog'),
      method: 'GET',
      path: '/api/v1/synthetic',
      status: 200,
      durationMs: 1,
      ip: '203.0.113.9',
      userAgent: null,
      query: {},
      requestBody: null,
      responseBody: { included: [{ type: 'network', id: network.id }] },
      resourceId: network.id,
    });

    const result = await redactInquiryRecords(database.db, env, seeded.inquiry.id, { at: AT });

    expect(result?.alreadyRedacted).toBe(false);
    const rows = await database.db.execute(
      sql`select n.ip, n.location as network_location, n.asn::int as asn, n.country_code,
                 n.threat_level, s.location as session_location, s.country_code as session_country
            from networks n join inquiry_sessions s on s.id = n.inquiry_session_id
           where n.id = ${network.id}`,
    );
    expect(rows.rows).toEqual([
      {
        ip: null,
        network_location: null,
        asn: 64_502,
        country_code: 'ZZ',
        threat_level: 'low',
        session_location: null,
        session_country: 'ZZ',
      },
    ]);
    expect((await getEvent(database.db, env, event.id))?.redactedAt).toEqual(AT);
    expect(await getApiLog(database.db, env, copy.id)).toMatchObject({ responseBody: null });
  });

  it('nulls the signal bodies, unlinks the session from its devices, deletes each device left without a session, and stubs and forgets the devices (C91.4, C107.5)', async () => {
    const seeded = await seedInquiry();
    const { env } = seeded;
    await seedSessionSignalBody(database.db, env, {
      inquirySessionId: seeded.session.id,
      sequence: 0,
      components: { integrity: { timezone: SUBJECT } },
      behaviour: { 'paste-count': 2 },
    });
    await seedSessionSignalBody(database.db, env, {
      inquirySessionId: seeded.session.id,
      sequence: 1,
    });
    const other = await createTestInquiry(database.db, env);
    const otherSession = await createInquirySession(database.db, env, {
      id: testId('iqse'),
      inquiryId: other.inquiry.id,
      tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const resumed = await createInquirySession(database.db, env, {
      id: testId('iqse'),
      inquiryId: seeded.inquiry.id,
      tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    // A session links to one device; a device may serve sessions of several inquiries.
    const only = await seedDevice(database.db, env, { sessionIds: [seeded.session.id] });
    const shared = await seedDevice(database.db, env, {
      sessionIds: [resumed.id, otherSession.id],
    });
    const event = await createEvent(database.db, env, {
      id: testId('evt'),
      name: 'inquiry-session.started',
      objectId: only.id,
      payload: { included: [{ type: 'device', id: only.id }] },
    });
    const copy = await createApiLog(database.db, env, {
      id: testId('alog'),
      method: 'GET',
      path: '/api/v1/devices',
      status: 200,
      durationMs: 1,
      ip: '203.0.113.9',
      userAgent: null,
      query: {},
      requestBody: null,
      responseBody: { data: [{ type: 'device', id: only.id }] },
      resourceId: only.id,
    });

    await redactInquiryRecords(database.db, env, seeded.inquiry.id, { at: AT });

    const bodies = await database.db.execute(
      sql`select sequence, components, behaviour from inquiry_session_signals
           where inquiry_session_id = ${seeded.session.id} order by sequence`,
    );
    expect(bodies.rows).toEqual([
      { sequence: 0, components: null, behaviour: null },
      { sequence: 1, components: null, behaviour: null },
    ]);
    const links = await database.db.execute(
      sql`select inquiry_session_id, device_id from session_devices
           where environment_id = ${env} order by inquiry_session_id`,
    );
    expect(links.rows).toEqual([{ inquiry_session_id: otherSession.id, device_id: shared.id }]);
    const left = await database.db.execute(
      sql`select id from devices where environment_id = ${env} order by id`,
    );
    expect(left.rows).toEqual([{ id: shared.id }]);
    expect((await getEvent(database.db, env, event.id))?.redactedAt).toEqual(AT);
    expect(await getApiLog(database.db, env, copy.id)).toMatchObject({ responseBody: null });
  });

  it('keeps to its environment', async () => {
    const { inquiry } = await seedInquiry();
    const other = (await createTestTenant(database.db)).environment.id;

    expect(await redactInquiryRecords(database.db, other, inquiry.id)).toBeNull();
  });
});

describe('redactAccountRecords (C16)', () => {
  it('removes the account fields, stubs its events, and names its inquiries', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const account = await createAccount(database.db, env, {
      id: testId('acc'),
      fields: { 'name-full': SUBJECT },
    });
    const { inquiry } = await createTestInquiry(database.db, env);
    await moveInquiriesToAccount(database.db, env, account.id, [inquiry.id]);
    const event = await createEvent(database.db, env, {
      id: testId('evt'),
      name: 'account.created',
      payload: {
        data: { type: 'account', id: account.id, attributes: { fields: { 'name-full': SUBJECT } } },
      },
    });

    const result = await redactAccountRecords(database.db, env, account.id, { at: AT });
    const again = await redactAccountRecords(database.db, env, account.id, { at: new Date() });
    const raw = await database.db.execute(
      sql`select fields from accounts where id = ${account.id}`,
    );

    expect(result).toMatchObject({
      alreadyRedacted: false,
      inquiryIds: [inquiry.id],
      stubbedEvents: 1,
    });
    expect(await getAccount(database.db, env, account.id)).toMatchObject({
      fields: {},
      redactedAt: AT,
    });
    expect(raw.rows).toEqual([{ fields: null }]);
    expect((await getEvent(database.db, env, event.id))?.payload).toEqual({
      data: { type: 'account', id: account.id, attributes: { 'redacted-at': AT.toISOString() } },
    });
    expect(again).toMatchObject({ alreadyRedacted: true, account: { redactedAt: AT } });
    expect(await redactAccountRecords(database.db, testId('env'), account.id)).toBeNull();
  });

  it('names the accounts consolidated into it, which keep their own fields (2B F007)', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const target = await createAccount(database.db, env, { id: testId('acc') });
    const sources = [
      await createAccount(database.db, env, {
        id: testId('acc'),
        fields: { 'name-full': SUBJECT },
      }),
      await createAccount(database.db, env, { id: testId('acc') }),
    ];
    const bystander = await createAccount(database.db, env, { id: testId('acc') });
    await consolidateAccounts(database.db, env, {
      targetId: target.id,
      sourceIds: sources.map((source) => source.id),
    });

    const result = await redactAccountRecords(database.db, env, target.id, { at: AT });

    expect(result?.consolidatedAccountIds).toEqual(sources.map((source) => source.id).sort());
    expect(
      (await redactAccountRecords(database.db, env, bystander.id, { at: AT }))
        ?.consolidatedAccountIds,
    ).toEqual([]);
  });
});

describe('forgetStoredResponses, reused by forgetReportCopies (K6A-12, owner decision 15)', () => {
  type Forget = (
    db: TestDatabase['db'],
    environmentId: string,
    objectIds: readonly string[],
  ) => Promise<void>;

  async function seedCopies(env: string, reportId: string) {
    const other = testId('rep');
    const resource = (id: string) => ({
      type: 'report/watchlist',
      id,
      attributes: { query: { 'name-first': SUBJECT } },
    });
    const log = (path: string, resourceId: string | null, responseBody: unknown) =>
      createApiLog(database.db, env, {
        id: testId('alog'),
        method: 'GET',
        path,
        status: 200,
        durationMs: 2,
        resourceId,
        responseBody,
      });
    const own = await log(`/api/v1/reports/${reportId}`, reportId, { data: resource(reportId) });
    const listed = await log('/api/v1/reports', null, {
      data: [resource(other), resource(reportId)],
    });
    const bystander = await log('/api/v1/reports', null, { data: [resource(other)] });
    const claim = await claimIdempotencyKey(database.db, env, {
      principalType: 'api_key',
      principalId: testId('key'),
      key: `create-${reportId}`,
      fingerprint: 'd'.repeat(64),
    });
    if (claim.outcome !== 'claimed') throw new Error(claim.outcome);
    await completeIdempotencyKey(database.db, env, claim.id, {
      status: 201,
      headers: {},
      body: JSON.stringify({ data: resource(reportId) }),
      resourceId: reportId,
    });
    return { own, listed, bystander, key: claim.id, other };
  }

  async function expectForgotten(env: string, copies: Awaited<ReturnType<typeof seedCopies>>) {
    for (const copy of [copies.own, copies.listed]) {
      expect(await getApiLog(database.db, env, copy.id), copy.path).toMatchObject({
        responseBody: null,
      });
    }
    expect((await getApiLog(database.db, env, copies.bystander.id))?.responseBody).not.toBeNull();
    const keys = await database.db.execute<{ id: number }>(
      sql`select id::int as id from idempotency_keys where id = ${copies.key}`,
    );
    expect(keys.rows).toEqual([]);
  }

  it('is exported from @openverify/db and clears the stored copies about or naming the ids', async () => {
    const forget = (repositories as Readonly<Record<string, unknown>>).forgetStoredResponses;
    expect(typeof forget).toBe('function');
    const { environment } = await createTestTenant(database.db);
    const reportId = testId('rep');
    const copies = await seedCopies(environment.id, reportId);

    await (forget as Forget)(database.db, environment.id, [reportId]);

    await expectForgotten(environment.id, copies);
  });

  it('is what forgetReportCopies runs for a report redacted on its own, beside the event stubs', async () => {
    const { environment } = await createTestTenant(database.db);
    const reportId = testId('rep');
    const copies = await seedCopies(environment.id, reportId);

    expect(await forgetReportCopies(database.db, environment.id, [reportId], AT)).toBe(0);
    expect(await forgetReportCopies(database.db, environment.id, [], AT)).toBe(0);

    await expectForgotten(environment.id, copies);
  });
});
