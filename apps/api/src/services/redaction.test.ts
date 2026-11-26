/**
 * C16 redaction against PGlite and in-memory storage: every stored copy of a subject's PII
 * goes, the redaction is idempotent, and later reads can tell (410 `redacted`). Every value
 * is synthetic.
 */
import {
  consolidateAccounts,
  createAccount,
  createEvent,
  createOneTimeLink,
  hashSessionToken,
  oneTimeLinks,
  ENCRYPTED_COLUMNS,
  files,
  getAccount,
  getChipRead,
  getCryptoChallenge,
  getEvent,
  getApiLog,
  getConsentRecord,
  getFile,
  listConsentRecordsOfSubjects,
  getGovernmentIdExtraction,
  getInquiry,
  getInquirySession,
  getOtpChallenge,
  getTransaction,
  getTransactionFile,
  getVerification,
  getVerificationInputs,
  openBusinessRegistryRecord,
  openChipChallengeEvidence,
  openChipReadEvidence,
  openCryptoChallengeEvidence,
  openDocumentExtractionFields,
  openOtpChallengeDestination,
  idempotencyKeys,
  listItemBackgrounds,
  listItemFaces,
  openJson,
  openValue,
  SEALED,
  type Sealed,
  listEvents,
  listSessionNetworks,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  openListMatchValues,
  openSessionSignalBodies,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError, RedactedError } from '../errors.js';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import type { FileStorage, ServiceContext } from '../ports.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../storage/index.js';
import {
  createRecordingAuditLogger,
  fixedClock,
  type RecordingAuditLogger,
  type TestClock,
} from '../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import {
  assertFileNotRedacted,
  assertInquiryNotRedacted,
  createRedactionService,
  fileRedactedAt,
  isAccountRedacted,
  isInquiryRedacted,
  purgeRedactedFiles,
} from './redaction.js';
import {
  OPERATOR_PII_TABLES,
  PII_MARKER,
  seedPiiSubject,
  SIMULATION_PRESET_TABLES,
  SUBJECT_PII_TABLES,
  THEME_ASSET_TABLES,
  EXPORT_PII_TABLES,
  THIRD_PARTY_REPORT_BULK_PII_TABLES,
  CONNECT_AGREEMENT_TABLES,
  CONSENT_PII_TABLES,
  OPERATOR_AUTH_SECRET_TABLES,
  ACCOUNT_EXPORT_TABLES,
  THIRD_PARTY_LIST_PII_TABLES,
  GRAPH_QUERY_PII_TABLES,
  WORKFLOW_RUN_PII_TABLES,
  CASE_PII_TABLES,
  DECISION_PII_TABLES,
  WORKFLOW_SECRET_TABLES,
  type SeededPiiSubject,
} from './redaction.test-support.js';

let database: TestDatabase;
let db: Db;
let events: TransactionalEventPublisher;
let storage: InMemoryFileStorage;
let audit: RecordingAuditLogger;
let clock: TestClock;
let ctx: ServiceContext;
const actor = { type: 'api-key', id: testId('key') } as const;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler({
      add: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  });
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const { organization, environment } = await createTestTenant(db);
  ctx = { organizationId: organization.id, environmentId: environment.id, requestId: 'req-1' };
  storage = createInMemoryFileStorage();
  audit = createRecordingAuditLogger();
  clock = fixedClock(new Date('2026-10-20T12:00:00.000Z'));
});

function service(overrides: { storage?: FileStorage; audit?: RecordingAuditLogger | null } = {}) {
  return createRedactionService({
    db,
    storage: overrides.storage ?? storage,
    events,
    clock,
    ...(overrides.audit === null ? {} : { audit: overrides.audit ?? audit }),
  });
}

const seed = (environmentId = ctx.environmentId) =>
  seedPiiSubject({ db, storage, keyring: database.keyring, environmentId });

async function eventsNamed(name: string, environmentId = ctx.environmentId) {
  return (await listEvents(db, environmentId, { name, size: 100 })).items;
}

/** C221.3: the inquiry's integrity tokens and verdict, opened for their rows. */
async function openIntegrityRecords(inquiryId: string): Promise<unknown[]> {
  const tokens = (
    await database.client.query<{ id: string; token: Sealed | null }>(
      'select id, token from inquiry_integrity_challenges where inquiry_id = $1',
      [inquiryId],
    )
  ).rows.map((row) =>
    row.token === null ? null : openValue(SEALED.integrityChallengeToken, row.id, row.token),
  );
  const verdicts = (
    await database.client.query<{ verdict: Sealed }>(
      'select verdict from inquiry_integrity_verdicts where inquiry_id = $1',
      [inquiryId],
    )
  ).rows.map((row) => openJson(SEALED.integrityVerdict, inquiryId, row.verdict));
  return [...tokens, ...verdicts];
}

/** Every decrypted copy of the subject that the database or storage still holds. */
async function remainingCopies(subject: SeededPiiSubject, environmentId = ctx.environmentId) {
  const copies: unknown[] = [
    await getAccount(db, environmentId, subject.accountId),
    await getInquiry(db, environmentId, subject.inquiryId),
    await getInquirySession(db, environmentId, subject.sessionId),
    await getVerification(db, environmentId, subject.verificationId),
    await getGovernmentIdExtraction(db, environmentId, subject.verificationId),
    await getVerificationInputs(db, environmentId, subject.inputsVerificationId),
    await openOtpChallengeDestination(db, environmentId, subject.otpChallengeId),
    await getOtpChallenge(db, environmentId, subject.otpChallengeId),
    await openCryptoChallengeEvidence(db, environmentId, subject.cryptoChallengeId),
    await getCryptoChallenge(db, environmentId, subject.cryptoChallengeId),
    // Workflow 5B (C53.3).
    await openDocumentExtractionFields(db, environmentId, subject.documentVerificationId),
    await openChipChallengeEvidence(db, environmentId, subject.chipChallengeId),
    await openChipReadEvidence(db, environmentId, subject.chipVerificationId),
    await getChipRead(db, environmentId, subject.chipVerificationId),
    await openBusinessRegistryRecord(db, environmentId, subject.businessVerificationId),
    // Workflow 7A (S) (C91.4): the session's signal bodies, opened.
    await openSessionSignalBodies(db, environmentId, subject.sessionId),
    // Workflow 10B Stage 1b (I) (C221.3): the integrity token and verdict, opened.
    ...(await openIntegrityRecords(subject.inquiryId)),
    // Workflow 7B (C98.4, C99.3): the list match's compared value and reason, opened.
    await openListMatchValues(db, environmentId, subject.listMatchId),
    // Workflow 7B (C98.4, C99.7): the face template of the item whose source is the inquiry, opened.
    ...(
      await db
        .select()
        .from(listItemFaces)
        .where(inArray(listItemFaces.itemId, subject.listItemIds))
    ).map((row) =>
      row.templateSealed === null
        ? null
        : openValue(SEALED.listItemFaceTemplate, row.itemId, row.templateSealed),
    ),
    ...(await db
      .select()
      .from(listItemBackgrounds)
      .where(inArray(listItemBackgrounds.itemId, subject.listItemIds))),
    ...(await listEvents(db, environmentId, { size: 100 })).items,
    ...(await Promise.all(subject.apiLogIds.map((id) => getApiLog(db, environmentId, id)))),
    ...(await db
      .select()
      .from(idempotencyKeys)
      .where(inArray(idempotencyKeys.id, subject.idempotencyKeyIds))),
    // K7A-9 (C91.3, C91.4): the session's network, its address and location opened.
    await listSessionNetworks(db, environmentId, [subject.sessionId]),
    // K7B-1: each linked transaction's sealed fields and file name, opened.
    ...(await Promise.all(
      Object.values(subject.transactions).map(async ({ id, fileId }) => [
        await getTransaction(db, environmentId, id),
        await getTransactionFile(db, environmentId, id, fileId),
      ]),
    )),
  ];
  const transactionKeys = Object.values(subject.transactions).map((row) => row.storageKey);
  for (const key of [...subject.storageKeys, subject.maskedObjectKey, ...transactionKeys]) {
    const object = await storage.get(key);
    if (object !== null) {
      copies.push(`storage object ${key}`);
    }
  }
  return copies;
}

describe('the PII redaction test covers every table that stores PII (C16 risk)', () => {
  it('seeds every encrypted table except operator data', () => {
    const encryptedTables = new Set(ENCRYPTED_COLUMNS.map((column) => column.table));
    for (const table of [
      ...OPERATOR_PII_TABLES,
      ...THIRD_PARTY_LIST_PII_TABLES,
      ...GRAPH_QUERY_PII_TABLES,
      ...WORKFLOW_RUN_PII_TABLES,
      ...DECISION_PII_TABLES,
      ...WORKFLOW_SECRET_TABLES,
      ...CASE_PII_TABLES,
      ...SIMULATION_PRESET_TABLES,
      ...THEME_ASSET_TABLES,
      ...EXPORT_PII_TABLES,
      ...THIRD_PARTY_REPORT_BULK_PII_TABLES,
      ...CONNECT_AGREEMENT_TABLES,
      ...CONSENT_PII_TABLES,
      ...OPERATOR_AUTH_SECRET_TABLES,
      ...ACCOUNT_EXPORT_TABLES,
    ]) {
      encryptedTables.delete(table);
    }

    expect([...encryptedTables].sort()).toEqual(
      // Check details and background layouts (C42.5) are personal data without a sealed column.
      SUBJECT_PII_TABLES.filter(
        (table) => table !== 'verification_checks' && table !== 'selfie_backgrounds',
      ).sort(),
    );
  });
});

describe('consent records (KP11-14; C241.3, C236.10)', () => {
  /** The subject's records, read by their subjects before a redaction clears the link. */
  const recordsOf = async (subject: SeededPiiSubject) =>
    listConsentRecordsOfSubjects(db, ctx.environmentId, [
      { type: 'inquiry', id: subject.inquiryId },
      { type: 'account', id: subject.accountId },
    ]);
  const reread = async (ids: readonly string[]) =>
    Promise.all(ids.map((id) => getConsentRecord(db, ctx.environmentId, id)));

  it('the subject holds consent records with sealed evidence, on its inquiry and its account', async () => {
    const subject = await seed();
    const records = await recordsOf(subject);
    expect(records.map(({ subjectType }) => subjectType).sort()).toEqual(['account', 'inquiry']);
    expect(JSON.stringify(records)).toContain(PII_MARKER);
    expect(JSON.stringify(records)).toContain('203.0.113.7');
  });

  it.each([
    ['an inquiry', 'redactInquiry', ['inquiry']],
    ['an account', 'redactAccount', ['account', 'inquiry']],
  ] as const)(
    '%s’s redaction clears the evidence and keeps the bare fact',
    async (_, how, cleared) => {
      const subject = await seed();
      const records = await recordsOf(subject);
      const reached = records.filter(({ subjectType }) =>
        (cleared as readonly string[]).includes(subjectType ?? ''),
      );
      expect(reached).toHaveLength(cleared.length);

      if (how === 'redactInquiry') {
        await service().redactInquiry(ctx, subject.inquiryId, actor);
      } else {
        await service().redactAccount(ctx, subject.accountId, actor);
      }

      const after = await reread(reached.map(({ id }) => id));
      expect(JSON.stringify(after)).not.toContain(PII_MARKER);
      expect(JSON.stringify(after)).not.toContain('203.0.113.7');
      for (const record of after) {
        expect(record).toMatchObject({
          redactedAt: clock.now(),
          subjectId: null,
          evidenceIp: null,
          evidenceUserAgent: null,
          attestedTextBody: null,
          evidenceReference: null,
        });
        expect(record?.textSha256).toMatch(/^[0-9a-f]{64}$/);
      }
    },
  );
});

describe('the networks table (K7A-9, C91.3, C91.4)', () => {
  const networksOf = async (subject: SeededPiiSubject) =>
    JSON.stringify(await listSessionNetworks(db, ctx.environmentId, [subject.sessionId]));

  it('holds a seeded row, so the scan sees it, and an inquiry’s redaction empties it', async () => {
    const subject = await seed();
    expect(await networksOf(subject)).toContain(PII_MARKER);
    expect(await networksOf(subject)).toContain('203.0.113.7');

    await service().redactInquiry(ctx, subject.inquiryId, actor);

    const remaining = await networksOf(subject);
    expect(remaining).not.toContain(PII_MARKER);
    expect(remaining).not.toContain('203.0.113.7');
  });

  it('is emptied by an account’s redaction too', async () => {
    const subject = await seed();

    await service().redactAccount(ctx, subject.accountId, actor);

    const remaining = await networksOf(subject);
    expect(remaining).not.toContain(PII_MARKER);
    expect(remaining).not.toContain('203.0.113.7');
  });
});

describe('redactAccount (C16)', () => {
  it('leaves nothing of the subject in any table or in storage', async () => {
    const subject = await seed();
    expect(JSON.stringify(await remainingCopies(subject))).toContain(PII_MARKER);

    const result = await service().redactAccount(ctx, subject.accountId, actor);

    expect(result).toEqual({ redactedAt: clock.now(), alreadyRedacted: false });
    const remaining = JSON.stringify(await remainingCopies(subject));
    expect(remaining).not.toContain(PII_MARKER);
    expect(remaining).not.toContain('203.0.113.7');
    // C91.4: the device known only through the subject's session goes with its HMACs.
    const devices = await db.execute(sql`select id from devices where id = ${subject.deviceId}`);
    expect((devices as { rows: unknown[] }).rows).toEqual([]);
    // C101.4 (plan (G) item 15): no graph row of the account, no stored result naming it.
    const graphRows = await db.execute(
      sql`select kind from graph_attributes where account_id = ${subject.accountId}`,
    );
    expect((graphRows as { rows: unknown[] }).rows).toEqual([]);
    const results = await db.execute(
      sql`select account_ids, nodes from graph_queries where id = ${subject.graphQueryId}`,
    );
    expect(JSON.stringify((results as { rows: unknown[] }).rows)).not.toContain(subject.accountId);
    expect(JSON.stringify((results as { rows: unknown[] }).rows)).toContain(subject.otherAccountId);
  });

  it('nulls the PII columns and empties the check details', async () => {
    const subject = await seed();

    await service().redactAccount(ctx, subject.accountId, actor);

    const account = await getAccount(db, ctx.environmentId, subject.accountId);
    expect(account).toMatchObject({ fields: {}, redactedAt: clock.now() });
    const inquiry = await getInquiry(db, ctx.environmentId, subject.inquiryId);
    expect(inquiry).toMatchObject({ fields: {}, note: null, redactedAt: clock.now() });
    const session = await getInquirySession(db, ctx.environmentId, subject.sessionId);
    expect(session).toMatchObject({ ip: null, userAgent: null });
    expect(session?.consent).toMatchObject({ ip: null, userAgent: null, locale: 'en' });
    const verification = await getVerification(db, ctx.environmentId, subject.verificationId);
    expect(verification?.checks.map(({ metadata, reasons }) => ({ metadata, reasons }))).toEqual([
      { metadata: {}, reasons: [] },
    ]);
    // C31.7: the extraction, its blind index and its perceptual hash go; the source names stay.
    expect(
      await getGovernmentIdExtraction(db, ctx.environmentId, subject.verificationId),
    ).toMatchObject({
      fields: null,
      fieldSources: { 'name-first': ['mrz', 'viz'], birthdate: ['mrz', 'viz'] },
      identificationNumberIndex: null,
      frontPhash: null,
      frontPhashBands: null,
      redactedAt: clock.now(),
    });
  });

  it('deletes the files from storage and marks them deleted', async () => {
    const subject = await seed();

    await service().redactAccount(ctx, subject.accountId, actor);

    for (const key of subject.storageKeys) {
      expect(await storage.get(key)).toBeNull();
    }
    for (const id of subject.fileIds) {
      expect((await getFile(db, ctx.environmentId, id))?.deletedAt).toEqual(clock.now());
    }
  });

  it('replaces every stored event payload that embeds the subject with the C16 stub', async () => {
    const subject = await seed();

    await service().redactAccount(ctx, subject.accountId, actor);

    const stub = (type: string, id: string) => ({
      data: { type, id, attributes: { 'redacted-at': clock.now().toISOString() } },
    });
    const byName = async (name: string) => (await eventsNamed(name))[0]?.payload;
    expect(await byName('inquiry.created')).toEqual(stub('inquiry', subject.inquiryId));
    expect(await byName('verification.failed')).toEqual(
      stub('verification/government-id', subject.verificationId),
    );
    expect(await byName('inquiry-session.started')).toEqual(
      stub('inquiry-session', subject.sessionId),
    );
    expect(await byName('account.created')).toEqual(stub('account', subject.accountId));
    expect(await byName('account.consolidated')).toEqual(stub('account', subject.otherAccountId));
  });

  it('emits inquiry.redacted for each inquiry, then account.redacted, and audits both', async () => {
    const subject = await seed();

    await service().redactAccount(ctx, subject.accountId, actor);

    const [inquiryEvent] = await eventsNamed('inquiry.redacted');
    expect(inquiryEvent?.payload).toMatchObject({
      data: { type: 'inquiry', id: subject.inquiryId, attributes: { fields: {} } },
    });
    const [accountEvent] = await eventsNamed('account.redacted');
    expect(accountEvent?.payload).toMatchObject({
      data: {
        type: 'account',
        id: subject.accountId,
        attributes: { fields: {}, 'redacted-at': clock.now().toISOString() },
      },
    });
    expect(JSON.stringify([inquiryEvent, accountEvent])).not.toContain(PII_MARKER);
    expect(audit.entries.map((entry) => [entry.action, entry.resourceId])).toEqual([
      ['inquiry.redacted', subject.inquiryId],
      ['account.redacted', subject.accountId],
    ]);
    expect(audit.entries[1]).toMatchObject({
      environmentId: ctx.environmentId,
      organizationId: ctx.organizationId,
      actor,
      resourceType: 'account',
      requestId: 'req-1',
      metadata: { 'inquiry-count': 1 },
    });
    expect(audit.entries[0]?.metadata).toMatchObject({
      'account-id': subject.accountId,
      'file-count': 2,
    });
  });

  it('is idempotent: a second call changes nothing and keeps the first time', async () => {
    const subject = await seed();
    await service().redactAccount(ctx, subject.accountId, actor);
    clock.advance(60_000);

    const again = await service().redactAccount(ctx, subject.accountId, actor);

    expect(again).toEqual({
      redactedAt: new Date('2026-10-20T12:00:00.000Z'),
      alreadyRedacted: true,
    });
    expect(await eventsNamed('account.redacted')).toHaveLength(1);
    expect(await eventsNamed('inquiry.redacted')).toHaveLength(1);
    expect(audit.entries).toHaveLength(2);
  });

  it('redacts an account without inquiries', async () => {
    const other = await seed();
    const result = await service().redactAccount(ctx, other.otherAccountId, actor);

    expect(result.alreadyRedacted).toBe(false);
    expect(await isAccountRedacted(db, ctx.environmentId, other.otherAccountId)).toBe(true);
    expect(await isInquiryRedacted(db, ctx.environmentId, other.inquiryId)).toBe(false);
  });

  it('writes no audit entry for a background job (actor null)', async () => {
    const subject = await seed();

    await service().redactAccount(ctx, subject.accountId, null);

    expect(audit.entries).toEqual([]);
    expect(await eventsNamed('account.redacted')).toHaveLength(1);
  });

  it("refuses another environment's account with a 404 and changes nothing", async () => {
    const subject = await seed();
    const other = await createTestTenant(db);
    const outsider = { organizationId: other.organization.id, environmentId: other.environment.id };

    await expect(
      service().redactAccount(outsider, subject.accountId, actor),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await isAccountRedacted(db, ctx.environmentId, subject.accountId)).toBe(false);
  });

  it('redacts the accounts consolidated into it: their fields, events and copies (2B F007)', async () => {
    const subject = await seed();
    const absorbed = await createAccount(db, ctx.environmentId, {
      id: testId('acc'),
      fields: { name_first: `Absorbed ${PII_MARKER}` },
    });
    const created = await createEvent(db, ctx.environmentId, {
      id: testId('evt'),
      name: 'account.created',
      payload: {
        data: {
          type: 'account',
          id: absorbed.id,
          attributes: { fields: { name_first: `Absorbed ${PII_MARKER}` } },
        },
      },
    });
    await consolidateAccounts(db, ctx.environmentId, {
      targetId: subject.accountId,
      sourceIds: [absorbed.id],
    });

    await service().redactAccount(ctx, subject.accountId, actor);

    const source = await getAccount(db, ctx.environmentId, absorbed.id);
    expect(source).toMatchObject({ fields: {}, redactedAt: clock.now() });
    expect(JSON.stringify(await getEvent(db, ctx.environmentId, created.id))).not.toContain(
      PII_MARKER,
    );
    expect((await eventsNamed('account.redacted')).map((event) => event.objectId).sort()).toEqual(
      [subject.accountId, absorbed.id].sort(),
    );
    expect(
      audit
        .withAction('account.redacted')
        .map((entry) => entry.resourceId)
        .sort(),
    ).toEqual([subject.accountId, absorbed.id].sort());
  });

  it("leaves other subjects' data alone", async () => {
    const subject = await seed();
    const bystander = await seed();

    await service().redactAccount(ctx, subject.accountId, actor);

    expect(JSON.stringify(await remainingCopies(bystander))).toContain(PII_MARKER);
    expect((await getAccount(db, ctx.environmentId, bystander.accountId))?.redactedAt).toBeNull();
  });
});

describe('redactInquiry (C16)', () => {
  it('redacts the inquiry and its copies but not its account', async () => {
    const subject = await seed();

    const result = await service().redactInquiry(ctx, subject.inquiryId, actor);

    expect(result).toEqual({ redactedAt: clock.now(), alreadyRedacted: false });
    // C101.4: the rows the inquiry contributed go; the account's own stay.
    const graphRows = await db.execute(
      sql`select source_type from graph_attributes where account_id = ${subject.accountId}`,
    );
    expect((graphRows as { rows: unknown[] }).rows).toEqual([{ source_type: 'account' }]);
    expect(await getInquiry(db, ctx.environmentId, subject.inquiryId)).toMatchObject({
      fields: {},
      note: null,
    });
    expect(
      JSON.stringify((await getAccount(db, ctx.environmentId, subject.accountId))?.fields),
    ).toContain(PII_MARKER);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'inquiry.redacted',
        resourceType: 'inquiry',
        resourceId: subject.inquiryId,
        actor,
        // C40.1: the selfie.created event of the subject's capture is stubbed too.
        metadata: { 'file-count': 2, 'stubbed-event-count': 4 },
      }),
    ]);
    expect(await eventsNamed('inquiry.redacted')).toHaveLength(1);
  });

  it('clears every API log and idempotent copy that mentions the inquiry, lists included (2B F005, F017)', async () => {
    const subject = await seed();

    await service().redactInquiry(ctx, subject.inquiryId, actor);

    const logs = await Promise.all(
      subject.apiLogIds.map((id) => getApiLog(db, ctx.environmentId, id)),
    );
    // The account's own copies stay: redacting an inquiry does not redact its account.
    const aboutAccount = (path = '') =>
      path === '/api/v1/accounts' || path.endsWith(subject.accountId);
    const mentioning = logs.filter((log) => !aboutAccount(log?.path));
    // The inquiry's lists and events, and (C40.1) the request about its selfie capture.
    expect(mentioning).toHaveLength(4);
    expect(mentioning.map((log) => log?.responseBody)).toEqual([null, null, null, null]);
    expect(JSON.stringify(mentioning)).not.toContain(PII_MARKER);
  });

  it('cancels the active sessions and revokes the unused one-time links of an open inquiry (2B F018)', async () => {
    const subject = await seed();
    const { link } = await createOneTimeLink(db, ctx.environmentId, {
      inquiryId: subject.inquiryId,
      tokenHash: hashSessionToken(`ovo_${testId('iqse')}`),
      expiresAt: new Date(clock.now().getTime() + 3_600_000),
    });

    await service().redactInquiry(ctx, subject.inquiryId, actor);

    expect(await getInquirySession(db, ctx.environmentId, subject.sessionId)).toMatchObject({
      status: 'canceled',
      canceledAt: clock.now(),
      revokedAt: clock.now(),
    });
    const [stored] = await db.select().from(oneTimeLinks).where(eq(oneTimeLinks.id, link.id));
    expect(stored?.revokedAt).toEqual(clock.now());
    const [canceled] = await eventsNamed('inquiry-session.canceled');
    expect(canceled?.objectId).toBe(subject.sessionId);
    expect(JSON.stringify(canceled)).not.toContain(PII_MARKER);
  });

  it('is idempotent', async () => {
    const subject = await seed();
    await service().redactInquiry(ctx, subject.inquiryId, actor);
    clock.advance(5_000);

    const again = await service().redactInquiry(ctx, subject.inquiryId, actor);

    expect(again.alreadyRedacted).toBe(true);
    expect(again.redactedAt).toEqual(new Date('2026-10-20T12:00:00.000Z'));
    expect(await eventsNamed('inquiry.redacted')).toHaveLength(1);
    expect(audit.entries).toHaveLength(1);
  });

  it("refuses another environment's inquiry with a 404", async () => {
    const subject = await seed();
    const other = await createTestTenant(db);

    await expect(
      service().redactInquiry(
        { organizationId: other.organization.id, environmentId: other.environment.id },
        subject.inquiryId,
        actor,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service().redactInquiry(ctx, testId('inq'), actor)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('needs an audit logger to redact for a principal', async () => {
    const subject = await seed();

    await expect(
      service({ audit: null }).redactInquiry(ctx, subject.inquiryId, actor),
    ).rejects.toThrow(/audit/);
    expect(await isInquiryRedacted(db, ctx.environmentId, subject.inquiryId)).toBe(false);
    await service({ audit: null }).redactInquiry(ctx, subject.inquiryId, null);
    expect(await isInquiryRedacted(db, ctx.environmentId, subject.inquiryId)).toBe(true);
  });

  it('finishes the file deletion on a retry when storage failed', async () => {
    const subject = await seed();
    let failures = 1;
    const flaky: FileStorage = {
      put: (key, bytes) => storage.put(key, bytes),
      get: (key) => storage.get(key),
      delete: (key) => {
        // The inquiry's own files: a cascaded transaction's object is the C16 purge's (K7B-1).
        if (failures > 0 && subject.storageKeys.includes(key)) {
          failures -= 1;
          return Promise.reject(new Error('storage unavailable'));
        }
        return storage.delete(key);
      },
    };

    await expect(
      service({ storage: flaky }).redactInquiry(ctx, subject.inquiryId, actor),
    ).rejects.toThrow(/files/);
    expect(await isInquiryRedacted(db, ctx.environmentId, subject.inquiryId)).toBe(true);
    const marked = await Promise.all(
      subject.fileIds.map(
        async (id) => (await getFile(db, ctx.environmentId, id))?.deletedAt ?? null,
      ),
    );
    expect(marked.filter((value) => value === null)).toHaveLength(1);

    const retried = await service({ storage: flaky }).redactInquiry(ctx, subject.inquiryId, actor);

    expect(retried.alreadyRedacted).toBe(true);
    for (const key of subject.storageKeys) {
      expect(await storage.get(key)).toBeNull();
    }
    for (const id of subject.fileIds) {
      expect((await getFile(db, ctx.environmentId, id))?.deletedAt).not.toBeNull();
    }
  });
});

describe('purgeRedactedFiles', () => {
  it('deletes the files that redacted inquiries left in storage, in batches', async () => {
    const subject = await seed();
    const failing: FileStorage = {
      ...storage,
      delete: () => Promise.reject(new Error('storage unavailable')),
    };
    await expect(
      service({ storage: failing }).redactInquiry(ctx, subject.inquiryId, null),
    ).rejects.toThrow();
    const untouched = await seed();

    const purged = await purgeRedactedFiles({ db, storage, clock, limit: 1 });

    expect(purged).toBe(2);
    for (const key of subject.storageKeys) {
      expect(await storage.get(key)).toBeNull();
    }
    for (const key of untouched.storageKeys) {
      expect(await storage.get(key)).not.toBeNull();
    }
    expect(await purgeRedactedFiles({ db, storage, clock })).toBe(0);
  });
});

describe('redaction state for later reads (410 redacted)', () => {
  it('tells whether an inquiry or account is redacted, per environment', async () => {
    const subject = await seed();
    const other = await createTestTenant(db);

    expect(await isInquiryRedacted(db, ctx.environmentId, subject.inquiryId)).toBe(false);
    await service().redactInquiry(ctx, subject.inquiryId, actor);

    expect(await isInquiryRedacted(db, ctx.environmentId, subject.inquiryId)).toBe(true);
    expect(await isInquiryRedacted(db, other.environment.id, subject.inquiryId)).toBe(false);
    expect(await isAccountRedacted(db, ctx.environmentId, subject.accountId)).toBe(false);
  });

  it('refuses file content of a redacted inquiry with 410 redacted', async () => {
    const subject = await seed();
    const [fileId = ''] = subject.fileIds;

    expect(await fileRedactedAt(db, ctx.environmentId, fileId)).toBeNull();
    await expect(assertFileNotRedacted(db, ctx.environmentId, fileId)).resolves.toBeUndefined();
    await service().redactInquiry(ctx, subject.inquiryId, actor);

    expect(await fileRedactedAt(db, ctx.environmentId, fileId)).toEqual(clock.now());
    const refusal = assertFileNotRedacted(db, ctx.environmentId, fileId);
    await expect(refusal).rejects.toBeInstanceOf(RedactedError);
    await expect(refusal).rejects.toMatchObject({
      status: 410,
      type: 'https://openverify.dev/problems/redacted',
    });
  });

  it('refuses writes of PII to a redacted inquiry with 410 redacted', async () => {
    const subject = await seed();
    await expect(
      assertInquiryNotRedacted(db, ctx.environmentId, subject.inquiryId),
    ).resolves.toBeUndefined();

    await service().redactInquiry(ctx, subject.inquiryId, null);

    await expect(
      assertInquiryNotRedacted(db, ctx.environmentId, subject.inquiryId),
    ).rejects.toBeInstanceOf(RedactedError);
  });

  it('treats unknown files and inquiries as not redacted (the caller answers 404)', async () => {
    expect(await fileRedactedAt(db, ctx.environmentId, testId('file'))).toBeNull();
    expect(await isInquiryRedacted(db, ctx.environmentId, testId('inq'))).toBe(false);
    expect(await isAccountRedacted(db, ctx.environmentId, testId('acc'))).toBe(false);
  });

  it('reads a file deleted on its own as redacted', async () => {
    const subject = await seed();
    const [fileId = ''] = subject.fileIds;
    await db.update(files).set({ deletedAt: clock.now() }).where(eq(files.id, fileId));

    await expect(assertFileNotRedacted(db, ctx.environmentId, fileId)).rejects.toBeInstanceOf(
      RedactedError,
    );
  });
});
