/**
 * K7B-1 (owner decision 1 after Workflow 7B): an erased subject's transactions go with the subject.
 *
 * - An inquiry's redaction reaches every transaction whose `transaction_objects` names the inquiry
 *   or one of its verifications; an account's every transaction linked through
 *   `transaction_objects.account_id` or `transaction_relations.account_id`, and its inquiries'
 *   transactions follow from redacting those inquiries.
 * - Each goes through `redactTransactionInTx` in the same database transaction, keeping the pinned
 *   version's `never` fields, as the system, with `transaction.redacted` once per transaction.
 * - File objects go after the commit, and a failed delete is left to the C16 purge.
 * - **The cascade stop rule:** each object is redacted at most once per pass; an object already
 *   redacted is a no-change, with no second audit entry and no event; and nothing loops back: a
 *   transaction's own redaction never reaches its objects.
 * - A catch-up after the commit reaches a transaction linked while the redaction ran.
 *
 * Every value is synthetic.
 */
import { addTransactionObjects, getTransaction, listAuditLogs, listEvents } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedTransaction,
  seedTransactionFile,
  seedTransactionType,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEventPublisher, type TransactionalEventPublisher } from '../events/index.js';
import type { FileStorage, ServiceContext } from '../ports.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { createRecordingAuditLogger, fixedClock } from '../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { createRedactionService, purgeRedactedTransactionFiles } from './redaction.js';
import { PII_MARKER, seedPiiSubject } from './redaction.test-support.js';

let database: TestDatabase;
let events: TransactionalEventPublisher;
let ctx: ServiceContext;
let storage: ReturnType<typeof createInMemoryFileStorage>;
const clock = fixedClock(new Date('2026-10-20T12:00:00.000Z'));
const actor = { type: 'api-key', id: testId('key') } as const;

beforeAll(async () => {
  database = await createTestDatabase();
  events = createEventPublisher({
    db: database.db,
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
  const { organization, environment } = await createTestTenant(database.db);
  ctx = { organizationId: organization.id, environmentId: environment.id, requestId: 'req-1' };
  storage = createInMemoryFileStorage();
});

function service(overrides: { storage?: FileStorage; events?: TransactionalEventPublisher } = {}) {
  return createRedactionService({
    db: database.db,
    storage: overrides.storage ?? storage,
    events: overrides.events ?? events,
    clock,
    audit: createRecordingAuditLogger(),
  });
}

const seed = () =>
  seedPiiSubject({
    db: database.db,
    storage,
    keyring: database.keyring,
    environmentId: ctx.environmentId,
  });

const namedEvents = async (name: string) =>
  (await listEvents(database.db, ctx.environmentId, { name, size: 100 })).items;

const transaction = (id: string) => getTransaction(database.db, ctx.environmentId, id);

async function auditedTransactions(id: string) {
  const entries = await listAuditLogs(database.db, ctx.environmentId);
  return entries.filter(
    (entry) => entry.action === 'transaction.redacted' && entry.resourceId === id,
  );
}

describe('an inquiry’s redaction reaches its transactions (K7B-1)', () => {
  it('redacts those naming the inquiry or a verification, and leaves the account’s', async () => {
    const subject = await seed();

    await service().redactInquiry(ctx, subject.inquiryId, actor);

    const { inquiry, verification, account, relation } = subject.transactions;
    for (const { id, storageKey } of [inquiry, verification]) {
      expect(await transaction(id)).toMatchObject({ redactedAt: clock.now(), fields: null });
      expect(await storage.get(storageKey)).toBeNull();
    }
    for (const { id, storageKey } of [account, relation]) {
      expect((await transaction(id))?.redactedAt).toBeNull();
      expect(await storage.get(storageKey)).not.toBeNull();
    }
    expect(JSON.stringify(await transaction(account.id))).toContain(PII_MARKER);
  });

  it('records the redaction as the system, once, and stages one event per transaction', async () => {
    const subject = await seed();

    await service().redactInquiry(ctx, subject.inquiryId, actor);
    await service().redactInquiry(ctx, subject.inquiryId, actor);

    const { id } = subject.transactions.inquiry;
    const audited = await auditedTransactions(id);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ actorType: 'system', actorId: null });
    expect(audited[0]?.metadata).toMatchObject({
      'inquiry-id': subject.inquiryId,
      'include-never': false,
    });
    const redacted = await namedEvents('transaction.redacted');
    expect(redacted).toHaveLength(2);
  });
});

describe('an account’s redaction reaches its transactions (K7B-1)', () => {
  it('redacts every kind of link, and leaves no field and no object', async () => {
    const subject = await seed();

    await service().redactAccount(ctx, subject.accountId, actor);

    for (const { id, storageKey } of Object.values(subject.transactions)) {
      expect(await transaction(id)).toMatchObject({ redactedAt: clock.now(), fields: null });
      expect(await storage.get(storageKey)).toBeNull();
    }
    expect(await namedEvents('transaction.redacted')).toHaveLength(4);
  });
});

describe('a `never` field (owner decision 1 after 7B)', () => {
  it('stays through a cascade, which never uses include-never', async () => {
    const subject = await seed();
    const type = await seedTransactionType(database.db, ctx.environmentId, {
      fieldSchemas: [
        { key: 'ledger', type: 'string', config: { 'redaction-policy': 'never' } },
        { key: 'note', type: 'string' },
      ],
    });
    const { id } = await seedTransaction(database.db, ctx.environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
      fields: { ledger: 'AML record', note: `Linked ${PII_MARKER}` },
    });
    await addTransactionObjects(database.db, ctx.environmentId, id, [subject.inquiryId]);

    await service().redactInquiry(ctx, subject.inquiryId, actor);

    expect((await transaction(id))?.fields).toEqual({ ledger: 'AML record' });
  });
});

describe('the cascade stop rule (K7B-1, Phase 8)', () => {
  it('redacts an account, its inquiry and a transaction linked to both exactly once in one pass', async () => {
    const subject = await seed();
    const { id } = subject.transactions.inquiry;
    await addTransactionObjects(database.db, ctx.environmentId, id, [subject.accountId]);

    await service().redactAccount(ctx, subject.accountId, actor);

    expect(await namedEvents('account.redacted')).toHaveLength(1);
    expect(await namedEvents('inquiry.redacted')).toHaveLength(1);
    const redacted = (await namedEvents('transaction.redacted')).filter(
      (event) => event.objectId === id,
    );
    expect(redacted).toHaveLength(1);
    expect(await auditedTransactions(id)).toHaveLength(1);
  });

  it('is a no-change on a second pass: no event, no audit entry', async () => {
    const subject = await seed();
    await service().redactAccount(ctx, subject.accountId, actor);
    const before = await namedEvents('transaction.redacted');
    const audited = await listAuditLogs(database.db, ctx.environmentId);

    await service().redactAccount(ctx, subject.accountId, actor);

    expect(await namedEvents('transaction.redacted')).toHaveLength(before.length);
    expect(await listAuditLogs(database.db, ctx.environmentId)).toHaveLength(audited.length);
  });

  it('never loops back: a transaction’s own redaction leaves its objects', async () => {
    const subject = await seed();

    await service().redactTransaction(ctx, subject.transactions.inquiry.id, actor);

    expect(await namedEvents('inquiry.redacted')).toHaveLength(0);
    expect(await namedEvents('account.redacted')).toHaveLength(0);
  });
});

describe('after the commit (K7B-1, F04)', () => {
  it('leaves a failed object delete to the C16 purge, without failing the redaction', async () => {
    const subject = await seed();
    const { storageKey } = subject.transactions.inquiry;
    const failing: FileStorage = {
      ...storage,
      delete: (key) =>
        key === storageKey ? Promise.reject(new Error('storage is down')) : storage.delete(key),
    };

    await expect(
      service({ storage: failing }).redactInquiry(ctx, subject.inquiryId, actor),
    ).resolves.toMatchObject({ alreadyRedacted: false });

    expect(await storage.get(storageKey)).not.toBeNull();
    await purgeRedactedTransactionFiles({ db: database.db, storage, clock });
    expect(await storage.get(storageKey)).toBeNull();
  });

  it('catches up with a transaction linked while the inquiry was being redacted', async () => {
    const subject = await seed();
    const type = await seedTransactionType(database.db, ctx.environmentId);
    const late = await seedTransaction(database.db, ctx.environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
      fields: { note: `Late ${PII_MARKER}` },
    });
    await seedTransactionFile(database.db, ctx.environmentId, { transactionId: late.id });
    let linked = false;
    const linking: TransactionalEventPublisher = {
      ...events,
      dispatch: async (staged) => {
        await events.dispatch(staged);
        if (!linked) {
          linked = true;
          await addTransactionObjects(database.db, ctx.environmentId, late.id, [
            subject.inquiryId,
          ]);
        }
      },
    };

    await service({ events: linking }).redactInquiry(ctx, subject.inquiryId, actor);

    expect(await transaction(late.id)).toMatchObject({ redactedAt: clock.now(), fields: null });
  });
});
