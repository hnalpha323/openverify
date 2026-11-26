/**
 * C253 (Workflow 11B, `dsar-export`): the `account_exports` repository on PGlite: the account lock,
 * one pending export per account, the job's claim and its ready and failed writes (a `pending` row
 * only), the C253.4 deletion of the exports listing an item or of the account, and the expiry that
 * clears the object and its data key while keeping the counts and times. Synthetic ids only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../client.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import {
  claimPendingAccountExport,
  deleteAccountExportsListing,
  expireAccountExports,
  getAccountExportRecord,
  hasPendingAccountExport,
  insertPendingAccountExport,
  lockAccountForExport,
  markAccountExportAdmitted,
  markAccountExportFailed,
  markAccountExportReady,
  releaseAccountExportAdmission,
  type AccountExportReady,
} from './account-exports.js';
import { createAccount } from './accounts.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let otherEnvironmentId: string;
let accountId: string;

const T0 = new Date('2026-11-13T12:00:00.000Z');
const DAY = 86_400_000;
const creator = { type: 'user' as const, id: testId('usr') };
const wrappedDek = () => `ov1.${'A'.repeat(11)}.${'B'.repeat(80)}`;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  environmentId = (await createTestTenant(db)).environment.id;
  otherEnvironmentId = (await createTestTenant(db)).environment.id;
  accountId = (await createAccount(db, environmentId, { id: testId('acc') })).id;
});

async function pending(account = accountId, at = T0): Promise<string> {
  const id = testId('aexp');
  await insertPendingAccountExport(db, environmentId, { id, accountId: account, creator, at });
  return id;
}

function ready(itemIds: readonly string[], readyAt = T0, days = 7): AccountExportReady {
  return {
    readyAt,
    expiresAt: new Date(readyAt.getTime() + days * DAY),
    itemCount: itemIds.length,
    byteCount: 2048,
    storageKey: `${environmentId}/account-exports/${testId('aexp')}`,
    wrappedDek: wrappedDek(),
    itemIds,
  };
}

describe('the account lock and the create (C253.1, C253.5)', () => {
  it('locks an account of the environment, never one elsewhere or unknown', async () => {
    await expect(lockAccountForExport(db, environmentId, accountId)).resolves.toBe(true);
    await expect(lockAccountForExport(db, otherEnvironmentId, accountId)).resolves.toBe(false);
    await expect(lockAccountForExport(db, environmentId, testId('acc'))).resolves.toBe(false);
  });

  it('writes a pending, unadmitted export at the given time, one pending per account', async () => {
    await expect(hasPendingAccountExport(db, environmentId, accountId)).resolves.toBe(false);
    const id = await pending();

    expect(await getAccountExportRecord(db, environmentId, id)).toMatchObject({
      id,
      environmentId,
      accountId,
      creatorType: 'user',
      creatorId: creator.id,
      status: 'pending',
      admittedAt: null,
      itemIds: [],
      createdAt: T0,
    });
    await expect(getAccountExportRecord(db, otherEnvironmentId, id)).resolves.toBeNull();
    await expect(hasPendingAccountExport(db, environmentId, accountId)).resolves.toBe(true);
    await expect(hasPendingAccountExport(db, otherEnvironmentId, accountId)).resolves.toBe(false);
    await expect(pending()).rejects.toThrow();
  });
});

describe('the admission stamp (C251.1)', () => {
  it('stamps a pending export once, and clears the stamp of one whose enqueue failed', async () => {
    const id = await pending();
    const at = new Date(T0.getTime() + 1000);

    await expect(markAccountExportAdmitted(db, otherEnvironmentId, id, at)).resolves.toBe(false);
    await expect(markAccountExportAdmitted(db, environmentId, id, at)).resolves.toBe(true);
    await expect(markAccountExportAdmitted(db, environmentId, id, T0)).resolves.toBe(false);
    expect((await getAccountExportRecord(db, environmentId, id))?.admittedAt).toEqual(at);

    await releaseAccountExportAdmission(db, environmentId, id);
    expect((await getAccountExportRecord(db, environmentId, id))?.admittedAt).toBeNull();

    await markAccountExportReady(db, environmentId, id, ready([accountId]));
    await expect(markAccountExportAdmitted(db, environmentId, id, at)).resolves.toBe(false);
  });
});

describe('the job’s writes (C253.2)', () => {
  it('claims a pending export only, and marks it ready with its ids once', async () => {
    const id = await pending();
    await expect(claimPendingAccountExport(db, otherEnvironmentId, id)).resolves.toBeNull();
    expect(await claimPendingAccountExport(db, environmentId, id)).toMatchObject({ id });

    const inquiryId = testId('inq');
    const done = await markAccountExportReady(
      db,
      environmentId,
      id,
      ready([accountId, inquiryId, inquiryId]),
    );
    expect(done).toMatchObject({
      status: 'ready',
      itemCount: 3,
      byteCount: 2048,
      readyAt: T0,
      expiresAt: new Date(T0.getTime() + 7 * DAY),
    });
    expect([...(done?.itemIds ?? [])].sort()).toEqual([accountId, inquiryId].sort());

    await expect(claimPendingAccountExport(db, environmentId, id)).resolves.toBeNull();
    await expect(markAccountExportReady(db, environmentId, id, ready([accountId]))).resolves.toBe(
      null,
    );
    await expect(hasPendingAccountExport(db, environmentId, accountId)).resolves.toBe(false);
  });

  it('marks a pending export failed with its code, and never a ready one', async () => {
    const id = await pending();
    await markAccountExportFailed(db, environmentId, id, 'account_export_too_large', T0);
    expect(await getAccountExportRecord(db, environmentId, id)).toMatchObject({
      status: 'failed',
      errorCode: 'account_export_too_large',
    });

    const other = await pending();
    await markAccountExportReady(db, environmentId, other, ready([accountId]));
    await markAccountExportFailed(db, environmentId, other, 'account_export_unavailable', T0);
    expect(await getAccountExportRecord(db, environmentId, other)).toMatchObject({
      status: 'ready',
      errorCode: null,
    });
  });
});

describe('C253.4: an export never outlives what it lists', () => {
  it('deletes the exports listing an item or of the account, answering their object keys', async () => {
    const inquiryId = testId('inq');
    const listing = await pending();
    const made = ready([accountId, inquiryId]);
    await markAccountExportReady(db, environmentId, listing, made);
    const otherAccount = (await createAccount(db, environmentId, { id: testId('acc') })).id;
    const unrelated = await pending(otherAccount);
    await markAccountExportReady(db, environmentId, unrelated, ready([otherAccount]));

    await expect(deleteAccountExportsListing(db, environmentId, [])).resolves.toEqual([]);
    await expect(
      deleteAccountExportsListing(db, otherEnvironmentId, [inquiryId, accountId]),
    ).resolves.toEqual([]);
    await expect(deleteAccountExportsListing(db, environmentId, [inquiryId])).resolves.toEqual([
      { id: listing, environmentId, storageKey: made.storageKey },
    ]);
    await expect(getAccountExportRecord(db, environmentId, listing)).resolves.toBeNull();

    // A pending export lists nothing yet: it is matched by its account.
    const held = await pending();
    await expect(
      deleteAccountExportsListing(db, environmentId, [accountId, accountId]),
    ).resolves.toEqual([{ id: held, environmentId, storageKey: null }]);
    await expect(getAccountExportRecord(db, environmentId, unrelated)).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('expires ready exports past their life, oldest first up to the limit, keeping counts and times', async () => {
    const first = await pending();
    const firstReady = ready([accountId], new Date(T0.getTime() - 9 * DAY));
    await markAccountExportReady(db, environmentId, first, firstReady);
    const secondAccount = (await createAccount(db, environmentId, { id: testId('acc') })).id;
    const second = await pending(secondAccount);
    const secondReady = ready([secondAccount], new Date(T0.getTime() - 8 * DAY));
    await markAccountExportReady(db, environmentId, second, secondReady);
    const thirdAccount = (await createAccount(db, environmentId, { id: testId('acc') })).id;
    const fresh = await pending(thirdAccount);
    await markAccountExportReady(db, environmentId, fresh, ready([thirdAccount]));

    await expect(expireAccountExports(db, T0, 1)).resolves.toEqual([
      { id: first, environmentId, storageKey: firstReady.storageKey },
    ]);
    await expect(expireAccountExports(db, T0, 10)).resolves.toEqual([
      { id: second, environmentId, storageKey: secondReady.storageKey },
    ]);
    await expect(expireAccountExports(db, T0, 10)).resolves.toEqual([]);

    expect(await getAccountExportRecord(db, environmentId, first)).toMatchObject({
      status: 'expired',
      storageKey: null,
      wrappedDek: null,
      byteCount: null,
      itemCount: 1,
      readyAt: firstReady.readyAt,
      expiresAt: firstReady.expiresAt,
    });
    expect(await getAccountExportRecord(db, environmentId, fresh)).toMatchObject({
      status: 'ready',
    });
  });
});
