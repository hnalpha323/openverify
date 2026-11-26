/**
 * C100.2 (C16 pass): each importer's object goes when it is due, and its key and wrapped DEK with
 * it. The deletion comes first, so a failure leaves the row to try again. Synthetic values.
 */
import {
  completeImporter,
  createImporter,
  getImporter,
  type ImporterOutcome,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../jobs/testing.js';
import { purgeExpiredImportObjects } from './purge.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const ENDED = new Date('2026-10-01T00:00:00.000Z');
const DUE = new Date('2026-10-09T00:00:00.000Z');
const OUTCOME: ImporterOutcome = {
  status: 'ready',
  rowCount: 1,
  successfulCount: 1,
  duplicateCount: 0,
  alreadyPresentCount: 0,
  errorCount: 0,
  at: ENDED,
};

async function endedImport(environmentId: string, listId: string, at: Date = ENDED) {
  const id = testId('mprt');
  const storageKey = `imports/${id}`;
  await createImporter(database.db, environmentId, {
    id,
    listId,
    mode: 'all-or-nothing',
    encoding: 'utf-8',
    fileSha256: 'a'.repeat(64),
    fileBytes: 1,
    storageKey,
    wrappedDek: 'ov1.test.synthetic',
  });
  await completeImporter(database.db, environmentId, id, { ...OUTCOME, at });
  return { id, storageKey };
}

describe('purgeExpiredImportObjects', () => {
  it('deletes the due object, marks its row and counts it', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const { id, storageKey } = await endedImport(environment.id, list.id);
    const storage = createMemoryStorage();
    await storage.put(storageKey, Uint8Array.from([1]));

    const purged = await purgeExpiredImportObjects({ db: database.db, storage }, { now: DUE });

    expect(purged).toBeGreaterThanOrEqual(1);
    expect(storage.objects.has(storageKey)).toBe(false);
    expect(await getImporter(database.db, environment.id, id)).toMatchObject({
      storageKey: null,
      wrappedDek: null,
      objectDeletedAt: DUE,
    });
  });

  it('leaves an object not yet due', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const { id, storageKey } = await endedImport(environment.id, list.id, new Date('2026-10-08'));
    const storage = createMemoryStorage();
    await storage.put(storageKey, Uint8Array.from([1]));

    await purgeExpiredImportObjects({ db: database.db, storage }, { now: DUE });

    expect(storage.objects.has(storageKey)).toBe(true);
    expect(await getImporter(database.db, environment.id, id)).toMatchObject({ storageKey });
  });

  it('keeps the row findable when the storage refuses, so a later pass tries again', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const { id, storageKey } = await endedImport(environment.id, list.id);
    const storage = createMemoryStorage();
    vi.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('unreachable'));

    await expect(
      purgeExpiredImportObjects({ db: database.db, storage }, { now: DUE }),
    ).rejects.toThrow();

    expect(await getImporter(database.db, environment.id, id)).toMatchObject({ storageKey });
  });

  it('runs at the present time by default', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const { id } = await endedImport(environment.id, list.id);
    const storage = createMemoryStorage();

    await purgeExpiredImportObjects({ db: database.db, storage }, {});

    expect(await getImporter(database.db, environment.id, id)).toMatchObject({ storageKey: null });
  });

  it('answers 0 when nothing is due', async () => {
    const storage = createMemoryStorage();

    await expect(
      purgeExpiredImportObjects({ db: database.db, storage }, { now: new Date('2020-01-01') }),
    ).resolves.toBe(0);
  });
});
