/**
 * C241.1-C241.4, C236.10 (Workflow 11A, `api-consent` checkpoint 4): Connect in the redaction cascade
 * and the C16 pass, through the real redaction service.
 *
 * - An inquiry redacted before redemption fails its `created` token with `source_redacted` and
 *   `connect/share-token.failed` on both sides; a `pending` one is left to its job.
 * - An inquiry redacted after redemption changes nothing at the destination, which hears
 *   `connect/share-token.source-redacted`.
 * - The consent records about the inquiry (or its account, or a transaction) are redacted: the
 *   evidence, the attested text, the text keys and the subject link cleared, the bare fact kept.
 * - The pass deletes ended tokens, bare facts past their term and texts no record cites, and reports
 *   the counts.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  createConsentRecord,
  eventObject,
  getConsentRecord,
  listEvents,
  insertConsentTextIfAbsent,
  getConsentText,
  type NewOpenedConsentRecord,
} from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiry, createTestApi, type TestApi } from '../../test-support/harness.js';
import { createRedactionService } from '../redaction.js';
import { seedConnection, seedShareToken, shareTokenRow } from './consent.test-support.js';
import { connectRedactionHooks } from './redaction-hooks.js';
import { runConnectRetention } from './retention.js';

let api: TestApi;
let destination: Awaited<ReturnType<TestApi['newTenant']>>;
let connection: { id: string; policyId: string };

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
  destination = await api.newTenant();
  connection = await seedConnection(api.database.db, {
    sourceOrganizationId: api.organizationId,
    destinationOrganizationId: destination.organizationId,
  });
});

afterAll(async () => {
  await api.close();
});

const DAY = 86_400_000;

const record = async (
  subject: { type: string; id: string },
  extra: Partial<NewOpenedConsentRecord> = {},
) =>
  createConsentRecord(api.database.db, api.environmentId, {
    id: newId('cnsr'),
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: subject.type as 'inquiry',
    subjectId: subject.id,
    connectionId: connection.id,
    recipientOrganizationId: destination.organizationId,
    recipientName: 'Example Test Org',
    dataCategories: ['identity-fields'],
    explicitBiometric: false,
    textLocale: 'en',
    textKeys: ['share.consent.source'],
    textSha256: 'a'.repeat(64),
    method: 'flow',
    sessionId: newId('iqse'),
    evidenceIp: '192.0.2.77',
    evidenceUserAgent: 'synthetic-agent/7',
    acceptedAt: api.clock.now(),
    expiresAt: new Date(api.clock.now().getTime() + DAY),
    ...extra,
  });

const redaction = () =>
  createRedactionService({
    db: api.database.db,
    storage: api.storage,
    events: api.events,
    clock: api.clock,
    audit: api.audit,
  });

const actor = () => ({ type: 'api-key' as const, id: newId('key') });

const ctx = () => ({ organizationId: api.organizationId, environmentId: api.environmentId });

/** The outbox's events of `name` in an environment, by the id of the resource each is about. */
const outbox = async (name: string, environmentId: string) =>
  (await listEvents(api.database.db, environmentId, { name, size: 100 })).items.map(
    (event) => eventObject(event.payload).id,
  );

describe('an inquiry redacted (C241.1-C241.3)', () => {
  it('fails its created token, leaves a pending one, and redacts the records about it', async () => {
    const inquiryId = await createInquiry(api);
    const consent = await record(
      { type: 'inquiry', id: inquiryId },
      { evidenceReference: 'synthetic-ref' },
    );
    const created = await seedShareToken(api.database.db, {
      sourceEnvironmentId: api.environmentId,
      destinationEnvironmentId: destination.environmentId,
      connection,
      consentRecordId: consent.id,
      sourceId: inquiryId,
    });
    const other = await record({ type: 'inquiry', id: inquiryId });
    const pending = await seedShareToken(api.database.db, {
      sourceEnvironmentId: api.environmentId,
      destinationEnvironmentId: destination.environmentId,
      connection,
      consentRecordId: other.id,
      sourceId: inquiryId,
      status: 'pending',
    });

    await redaction().redactInquiry(ctx(), inquiryId, actor());

    expect(await shareTokenRow(api.database.db, created)).toMatchObject({
      status: 'failed',
      failure_reason: 'source_redacted',
    });
    expect((await shareTokenRow(api.database.db, pending)).status).toBe('pending');
    expect(await outbox('connect/share-token.failed', api.environmentId)).toContain(created);
    expect(await outbox('connect/share-token.failed', destination.environmentId)).toContain(
      created,
    );
    const redacted = await getConsentRecord(api.database.db, api.environmentId, consent.id);
    expect(redacted).toMatchObject({
      subjectId: null,
      evidenceIp: null,
      evidenceUserAgent: null,
      evidenceReference: null,
      textKeys: [],
      textSha256: 'a'.repeat(64),
    });
    expect(redacted?.redactedAt).not.toBeNull();
  });

  it('tells the destination of a source redacted after redemption, and changes nothing there', async () => {
    const inquiryId = await createInquiry(api);
    const consent = await record({ type: 'inquiry', id: inquiryId });
    const redeemed = await seedShareToken(api.database.db, {
      sourceEnvironmentId: api.environmentId,
      destinationEnvironmentId: destination.environmentId,
      connection,
      consentRecordId: consent.id,
      sourceId: inquiryId,
      status: 'redeemed',
    });
    await connectRedactionHooks.inquiryRedactedInTx(api.database.db, {
      environmentId: api.environmentId,
      id: inquiryId,
      at: api.clock.now(),
    });
    expect((await shareTokenRow(api.database.db, redeemed)).status).toBe('redeemed');
    expect(
      await outbox('connect/share-token.source-redacted', destination.environmentId),
    ).toContain(redeemed);
    expect(await outbox('connect/share-token.source-redacted', api.environmentId)).not.toContain(
      redeemed,
    );
  });
});

describe('an account and a transaction redacted (C241.3)', () => {
  it('redacts the records about the account and its inquiries, and about a transaction', async () => {
    const inquiryId = await createInquiry(api, { referenceId: 'synthetic-person-r' });
    const accountId =
      (
        await api.database.client.query<{ account_id: string }>(
          'select account_id from inquiries where id = $1',
          [inquiryId],
        )
      ).rows[0]?.account_id ?? '';
    const onAccount = await record({ type: 'account', id: accountId });
    const onInquiry = await record({ type: 'inquiry', id: inquiryId });
    await connectRedactionHooks.accountRedactedInTx(api.database.db, {
      environmentId: api.environmentId,
      id: accountId,
      at: api.clock.now(),
    });
    for (const id of [onAccount.id, onInquiry.id]) {
      expect((await getConsentRecord(api.database.db, api.environmentId, id))?.redactedAt).not.toBe(
        null,
      );
    }
    const transactionId = newId('txn');
    const onTransaction = await record({ type: 'transaction', id: transactionId });
    await connectRedactionHooks.transactionRedactedInTx(api.database.db, {
      environmentId: api.environmentId,
      id: transactionId,
      at: api.clock.now(),
    });
    expect(
      (await getConsentRecord(api.database.db, api.environmentId, onTransaction.id))?.subjectId,
    ).toBeNull();
  });
});

describe('the C16 pass (C241.3, C241.4)', () => {
  it('deletes ended tokens, bare facts past their term and uncited texts, and reports them', async () => {
    const inquiryId = await createInquiry(api);
    const consent = await record({ type: 'inquiry', id: inquiryId });
    const expired = await seedShareToken(api.database.db, {
      sourceEnvironmentId: api.environmentId,
      destinationEnvironmentId: destination.environmentId,
      connection,
      consentRecordId: consent.id,
      status: 'expired',
    });
    await api.database.client.query(
      'update connect_share_tokens set expired_at = $2 where id = $1',
      [expired, new Date(api.clock.now().getTime() - 31 * DAY)],
    );
    const fact = await record(
      { type: 'inquiry', id: newId('inq') },
      { textSha256: 'c'.repeat(64) },
    );
    await api.database.client.query('update consent_records set redacted_at = $2 where id = $1', [
      fact.id,
      new Date(api.clock.now().getTime() - DAY),
    ]);
    await insertConsentTextIfAbsent(api.database.db, api.environmentId, {
      sha256: 'd'.repeat(64),
      locale: 'en',
      body: 'Synthetic text nobody cites.',
      createdAt: new Date(api.clock.now().getTime() - 2 * DAY),
    });
    const now = api.clock.now();
    const report = await runConnectRetention({
      db: api.database.db,
      clock: api.clock,
      now,
      batch: { now, limit: 500 },
    });
    expect(report.deletedShareTokens).toBeGreaterThanOrEqual(1);
    expect(report.deletedConsentRecords).toBeGreaterThanOrEqual(1);
    expect(report.deletedConsentTexts).toBeGreaterThanOrEqual(1);
    await expect(shareTokenRow(api.database.db, expired)).rejects.toThrow();
    expect(await getConsentRecord(api.database.db, api.environmentId, fact.id)).toBeNull();
    expect(await getConsentText(api.database.db, api.environmentId, 'd'.repeat(64))).toBeNull();
    // The record the deleted token cited is not a bare fact (not redacted), so it stays.
    expect(await getConsentRecord(api.database.db, api.environmentId, consent.id)).not.toBeNull();
  });
});
