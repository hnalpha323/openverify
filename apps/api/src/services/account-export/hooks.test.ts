/**
 * C253.4 (Workflow 11B, `dsar-export`): `foundation-11b`'s hooks over real `account_exports` rows on
 * PGlite: the inquiry and account redaction cascades delete the exports listing the subject first
 * (a pending export of the account too) and their manifests after the commit, another environment's
 * and another account's exports untouched; the C16 pass expires an export past its life. Synthetic
 * values only.
 */
import { newId } from '@openverify/contracts';
import {
  getAccountExportRecord,
  insertPendingAccountExport,
  markAccountExportReady,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedReport,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceContext } from '../../ports.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../../storage/index.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
  type TestClock,
} from '../../test-support/fakes.js';
import { createRedactionService } from '../redaction.js';
import { seedPiiSubject, type SeededPiiSubject } from '../redaction.test-support.js';
import { accountExportHooks } from './hooks.js';
import { manifestStorageKey } from './service.js';

let database: TestDatabase;
let db: Db;
let ctx: ServiceContext;
let storage: InMemoryFileStorage;
let clock: TestClock;
let subject: SeededPiiSubject;

const T0 = new Date('2026-11-13T12:00:00.000Z');
const DAY = 86_400_000;
const actor = { type: 'api-key', id: testId('key') } as const;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const { organization, environment } = await createTestTenant(db);
  ctx = { organizationId: organization.id, environmentId: environment.id, requestId: 'req-aeh' };
  storage = createInMemoryFileStorage();
  clock = fixedClock(T0);
  subject = await seedPiiSubject({
    db,
    storage,
    keyring: database.keyring,
    environmentId: ctx.environmentId,
  });
});

/** A ready export of the subject's account listing `itemIds`, its manifest object stored. */
async function readyExport(
  itemIds: readonly string[],
  options: { environmentId?: string; accountId?: string; readyAt?: Date } = {},
): Promise<{ id: string; key: string }> {
  const environmentId = options.environmentId ?? ctx.environmentId;
  const id = newId('aexp');
  await insertPendingAccountExport(db, environmentId, {
    id,
    accountId: options.accountId ?? subject.accountId,
    creator: { type: 'api-key', id: actor.id },
    at: T0,
  });
  const key = manifestStorageKey(environmentId, id);
  await storage.put(key, Buffer.from('synthetic sealed manifest'));
  const readyAt = options.readyAt ?? T0;
  await markAccountExportReady(db, environmentId, id, {
    readyAt,
    expiresAt: new Date(readyAt.getTime() + 7 * DAY),
    itemCount: itemIds.length,
    byteCount: 25,
    storageKey: key,
    wrappedDek: `ov1.${'A'.repeat(11)}.${'B'.repeat(80)}`,
    itemIds,
  });
  return { id, key };
}

const redaction = () =>
  createRedactionService({
    db,
    storage,
    events: createRecordingEventPublisher(),
    clock,
    audit: createRecordingAuditLogger(),
  });

describe('accountExportHooks.subjectRedactedInTx (C253.4)', () => {
  it('deletes the exports listing an item in the caller’s transaction and answers their keys', async () => {
    const listing = await readyExport([subject.accountId, subject.inquiryId]);
    const other = await readyExport([subject.otherAccountId], {
      accountId: subject.otherAccountId,
    });

    const keys = await db.transaction((tx) =>
      accountExportHooks.subjectRedactedInTx(tx, {
        environmentId: ctx.environmentId,
        itemIds: [subject.inquiryId],
        at: T0,
      }),
    );

    expect(keys).toEqual([listing.key]);
    await expect(getAccountExportRecord(db, ctx.environmentId, listing.id)).resolves.toBeNull();
    await expect(getAccountExportRecord(db, ctx.environmentId, other.id)).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('runs in the inquiry cascade: the export and its manifest go with the redaction', async () => {
    const listing = await readyExport([subject.accountId, subject.inquiryId]);

    await redaction().redactInquiry(ctx, subject.inquiryId, actor);

    await expect(getAccountExportRecord(db, ctx.environmentId, listing.id)).resolves.toBeNull();
    expect(await storage.get(listing.key)).toBeNull();
  });

  it('runs in the account cascade: a pending export of the account goes too', async () => {
    const listing = await readyExport([subject.accountId]);
    const held = newId('aexp');
    const { environment: elsewhere } = await createTestTenant(db);
    const foreign = await readyExport([subject.accountId], { environmentId: elsewhere.id });
    await db.transaction(async (tx) => {
      // The ready export is not pending, so the account may hold one pending export as well.
      await insertPendingAccountExport(tx, ctx.environmentId, {
        id: held,
        accountId: subject.accountId,
        creator: { type: 'api-key', id: actor.id },
        at: T0,
      });
    });

    await redaction().redactAccount(ctx, subject.accountId, actor);

    await expect(getAccountExportRecord(db, ctx.environmentId, listing.id)).resolves.toBeNull();
    await expect(getAccountExportRecord(db, ctx.environmentId, held)).resolves.toBeNull();
    expect(await storage.get(listing.key)).toBeNull();
    await expect(getAccountExportRecord(db, elsewhere.id, foreign.id)).resolves.toMatchObject({
      status: 'ready',
    });
  });
});

// KP11-27 (Workflow 11F): a report's or a transaction's redaction, the C16 pass's
// (`redactDueObjects`) as well as an operator's, deletes the exports listing it first, in its own
// transaction, and their manifests after the commit.
describe('the report and transaction redactions delete the exports listing them (KP11-27)', () => {
  it('a report redaction deletes the export listing the report, and keeps the others', async () => {
    const template = await seedReportTemplate(db, ctx.environmentId);
    const reportId = await seedReport(db, ctx.environmentId, template);
    const listing = await readyExport([subject.accountId, reportId]);
    const other = await readyExport([subject.otherAccountId], {
      accountId: subject.otherAccountId,
    });

    await redaction().redactReport(ctx, reportId, null);

    await expect(getAccountExportRecord(db, ctx.environmentId, listing.id)).resolves.toBeNull();
    expect(await storage.get(listing.key)).toBeNull();
    await expect(getAccountExportRecord(db, ctx.environmentId, other.id)).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('a transaction redaction deletes the export listing the transaction', async () => {
    const type = await seedTransactionType(db, ctx.environmentId);
    const transaction = await seedTransaction(db, ctx.environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    const listing = await readyExport([subject.accountId, transaction.id]);

    await redaction().redactTransaction(ctx, transaction.id, null);

    await expect(getAccountExportRecord(db, ctx.environmentId, listing.id)).resolves.toBeNull();
    expect(await storage.get(listing.key)).toBeNull();
  });
});

describe('accountExportHooks.retention (C253.4)', () => {
  it('expires the exports past their life and deletes their manifests, counting them', async () => {
    // Cut a day later than the file's other exports, so an earlier drain leaves it.
    const due = await readyExport([subject.accountId], { readyAt: new Date(T0.getTime() + DAY) });

    await accountExportHooks.retention(
      { db, storage },
      { now: new Date(T0.getTime() + 7 * DAY), limit: 500 },
    );
    expect(await storage.get(due.key)).not.toBeNull();

    await expect(
      accountExportHooks.retention(
        { db, storage },
        { now: new Date(T0.getTime() + 8 * DAY), limit: 500 },
      ),
    ).resolves.toEqual({ expiredAccountExports: 1 });
    expect(await storage.get(due.key)).toBeNull();
    await expect(getAccountExportRecord(db, ctx.environmentId, due.id)).resolves.toMatchObject({
      status: 'expired',
      storageKey: null,
    });
  });
});
