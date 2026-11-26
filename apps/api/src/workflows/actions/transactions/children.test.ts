/**
 * Workflow 8A Stage 3 (`api-actions`; C127.7, C105.5, outcome 28): what a transaction's redaction
 * reaches through `transaction_children`, on the real redaction service: a child inquiry and report
 * go with it, its `transaction_objects` stay, an object already redacted is a no-change with no second
 * audit entry and no event, and no cascade loops back. Plus the transaction's `reviewer`. Synthetic
 * values.
 */
import { newId } from '@openverify/contracts';
import {
  addTransactionObjects,
  getInquiry,
  getReport,
  recordTransactionChild,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReport,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { biometricItemRedactor } from '../../../services/lists/biometric/index.js';
import { createRedactionService } from '../../../services/redaction.js';
import { createInMemoryFileStorage } from '../../../storage/index.js';
import {
  createFakeBiometricItemRedactor,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../../test-support/fakes.js';
import { setTransactionReviewerInTx } from './reviewer.js';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const at = new Date('2026-11-02T12:00:00.000Z');

async function fixture() {
  const { organization, environment } = await createTestTenant(db);
  const environmentId = environment.id;
  const events = createRecordingEventPublisher();
  const audit = createRecordingAuditLogger();
  const storage = createInMemoryFileStorage();
  const service = createRedactionService({
    db,
    storage,
    events,
    clock: fixedClock(at),
    audit,
    biometricItems: createFakeBiometricItemRedactor(),
  });
  const type = await seedTransactionType(db, environmentId);
  const newTransaction = () =>
    seedTransaction(db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
  const ctx = { organizationId: organization.id, environmentId };
  const child = (transactionId: string, childType: 'inquiry' | 'report', childId: string) =>
    recordTransactionChild(db, environmentId, {
      transactionId,
      childType,
      childId,
      workflowRunId: testId('wfr'),
    });
  const auditEntries = (action: string) =>
    database.client
      .query<{ resource_id: string; metadata: Record<string, unknown> }>(
        `select resource_id, metadata from audit_logs where environment_id = $1 and action = $2`,
        [environmentId, action],
      )
      .then(({ rows }) => rows);
  return {
    environmentId,
    events,
    audit,
    service,
    ctx,
    newTransaction,
    child,
    auditEntries,
    storage,
  };
}

const user = { type: 'user', id: newId('usr') } as const;

describe('a transaction’s redaction reaches its children (C127.7)', () => {
  it('redacts a child inquiry and its system entry names the transaction', async () => {
    const { environmentId, service, ctx, newTransaction, child, events, auditEntries } =
      await fixture();
    const transaction = await newTransaction();
    const inquiry = (await createTestInquiry(db, environmentId)).inquiry;
    await child(transaction.id, 'inquiry', inquiry.id);

    await service.redactTransaction(ctx, transaction.id, user, { includeNever: false });

    expect((await getInquiry(db, environmentId, inquiry.id))?.redactedAt).toEqual(at);
    expect(events.named('inquiry.redacted')).toHaveLength(1);
    expect(await auditEntries('inquiry.redacted')).toMatchObject([
      { resource_id: inquiry.id, metadata: { 'transaction-id': transaction.id } },
    ]);
  });

  it('redacts a child report', async () => {
    const { environmentId, service, ctx, newTransaction, child } = await fixture();
    const transaction = await newTransaction();
    const template = await seedReportTemplate(db, environmentId);
    const reportId = await seedReport(db, environmentId, { ...template, status: 'ready' });
    await child(transaction.id, 'report', reportId);

    await service.redactTransaction(ctx, transaction.id, user, { includeNever: false });

    expect((await getReport(db, environmentId, reportId))?.redactedAt).toEqual(at);
  });

  it('deletes the objects of a child’s biometric items after the commit (C98.4)', async () => {
    const { ctx, environmentId, service, newTransaction, child, storage } = await fixture();
    const transaction = await newTransaction();
    const { inquiry } = await createTestInquiry(db, environmentId);
    await child(transaction.id, 'inquiry', inquiry.id);
    const key = `${environmentId}/${'a'.repeat(64)}`;
    await storage.put(key, new Uint8Array([1]));
    const spy = vi.spyOn(biometricItemRedactor, 'redactBySource').mockResolvedValue({
      storageKeys: [key],
      changedLists: [],
      redactedItemIds: [],
    });
    onTestFinished(() => {
      spy.mockRestore();
    });

    await service.redactTransaction(ctx, transaction.id, user);

    expect(await storage.get(key)).toBeNull();
  });

  it('never reaches an object merely attached to it (C105.5)', async () => {
    const { environmentId, service, ctx, newTransaction } = await fixture();
    const transaction = await newTransaction();
    const inquiry = (await createTestInquiry(db, environmentId)).inquiry;
    await addTransactionObjects(db, environmentId, transaction.id, [inquiry.id]);

    await service.redactTransaction(ctx, transaction.id, user, { includeNever: false });

    expect((await getInquiry(db, environmentId, inquiry.id))?.redactedAt).toBeNull();
  });

  it('reads an object already redacted as a no-change: no event, no second entry', async () => {
    const { environmentId, service, ctx, newTransaction, child, events, auditEntries } =
      await fixture();
    const transaction = await newTransaction();
    const inquiry = (await createTestInquiry(db, environmentId)).inquiry;
    await child(transaction.id, 'inquiry', inquiry.id);
    await service.redactInquiry(ctx, inquiry.id, user);

    await service.redactTransaction(ctx, transaction.id, user, { includeNever: false });

    expect(events.named('inquiry.redacted')).toHaveLength(1);
    expect(await auditEntries('inquiry.redacted')).toHaveLength(0);
  });

  it('redacts each object once a pass, and nothing loops back (outcome 28)', async () => {
    const { environmentId, service, ctx, newTransaction, child, events } = await fixture();
    const first = await newTransaction();
    const second = await newTransaction();
    const attached = (await createTestInquiry(db, environmentId)).inquiry;
    const created = (await createTestInquiry(db, environmentId)).inquiry;
    await addTransactionObjects(db, environmentId, first.id, [attached.id]);
    await child(first.id, 'inquiry', created.id);
    // A child a run also attached, and a second transaction of the same child.
    await addTransactionObjects(db, environmentId, first.id, [created.id]);
    await addTransactionObjects(db, environmentId, second.id, [created.id]);

    await service.redactInquiry(ctx, attached.id, user);

    expect((await getInquiry(db, environmentId, created.id))?.redactedAt).toEqual(at);
    expect(events.named('inquiry.redacted')).toHaveLength(2);
    expect(events.named('transaction.redacted')).toHaveLength(2);
  });

  it('leaves a child of another environment alone', async () => {
    const { service, ctx, newTransaction, child, environmentId } = await fixture();
    const other = await createTestTenant(db);
    const foreign = (await createTestInquiry(db, other.environment.id)).inquiry;
    const transaction = await newTransaction();
    await child(transaction.id, 'inquiry', foreign.id);

    await service.redactTransaction(ctx, transaction.id, user, { includeNever: false });

    expect((await getInquiry(db, other.environment.id, foreign.id))?.redactedAt).toBeNull();
    expect(environmentId).not.toBe(other.environment.id);
  });
});

describe('a transaction’s reviewer (C127.7, V27)', () => {
  it('names whoever moved it last, a run included', async () => {
    const { environmentId, newTransaction } = await fixture();
    const { id } = await newTransaction();
    const runId = testId('wfr');
    await setTransactionReviewerInTx(db, {
      environmentId,
      transactionId: id,
      actor: { type: 'workflow-run', id: runId },
    });
    const { rows } = await database.client.query<{ reviewer_type: string; reviewer_id: string }>(
      `select reviewer_type, reviewer_id from transactions where id = $1`,
      [id],
    );
    expect(rows).toEqual([{ reviewer_type: 'workflow-run', reviewer_id: runId }]);
  });
});
