/**
 * C253.4 (Workflow 11B, `dsar-export`): the exports listing a redacted or deleted item are deleted
 * first, in the deletion's transaction, and their manifests after its commit; the retention pass
 * expires exports past their life and deletes their manifests. Over a fake store and in-memory
 * storage. Synthetic values only.
 */
import type { Db } from '@openverify/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../../storage/index.js';
import {
  deleteExportObjects,
  deleteExportsListingInTx,
  runAccountExportRetention,
  type AccountExportDeletionStore,
  type DeletedAccountExport,
} from './deletion.js';

const ENV = 'env_01M5CJXHGAKAJV1EY6T7EEFWQX';
const tx = {} as Db;
let storage: InMemoryFileStorage;
let listed: Map<string, { ids: string[]; storageKey: string | null; expiresAt: Date }>;

const store: AccountExportDeletionStore = {
  deleteExportsListing(_tx, environmentId, itemIds) {
    const deleted: DeletedAccountExport[] = [];
    for (const [id, row] of listed) {
      if (row.ids.some((item) => itemIds.includes(item))) {
        listed.delete(id);
        deleted.push({ id, environmentId, storageKey: row.storageKey });
      }
    }
    return Promise.resolve(deleted);
  },
  expireExports(_db, now, limit) {
    const expired: DeletedAccountExport[] = [];
    for (const [id, row] of listed) {
      if (row.expiresAt <= now && row.storageKey !== null && expired.length < limit) {
        expired.push({ id, environmentId: ENV, storageKey: row.storageKey });
        row.storageKey = null;
      }
    }
    return Promise.resolve(expired);
  },
};

beforeEach(async () => {
  storage = createInMemoryFileStorage();
  listed = new Map([
    [
      'aexp_01M5CN0000000000000011B100',
      {
        ids: ['acc_A', 'inq_A', 'file_A'],
        storageKey: `${ENV}/account-exports/aexp_01M5CN0000000000000011B100`,
        expiresAt: new Date('2026-11-20T00:00:00.000Z'),
      },
    ],
    [
      'aexp_01M5CN0000000000000011B101',
      {
        ids: ['acc_B', 'inq_B'],
        storageKey: `${ENV}/account-exports/aexp_01M5CN0000000000000011B101`,
        expiresAt: new Date('2026-11-14T00:00:00.000Z'),
      },
    ],
  ]);
  for (const row of listed.values()) {
    await storage.put(row.storageKey ?? '', Buffer.from('sealed'));
  }
});

describe('deleteExportsListingInTx (C253.4)', () => {
  it('deletes only the exports listing one of the items', async () => {
    const deleted = await deleteExportsListingInTx(tx, store, ENV, ['file_A', 'txn_other']);
    expect(deleted.map(({ id }) => id)).toEqual(['aexp_01M5CN0000000000000011B100']);
    expect([...listed.keys()]).toEqual(['aexp_01M5CN0000000000000011B101']);
  });

  it('does nothing for no items', async () => {
    expect(await deleteExportsListingInTx(tx, store, ENV, [])).toEqual([]);
    expect(listed.size).toBe(2);
  });
});

describe('deleteExportObjects', () => {
  it('deletes each manifest, answering the keys it could not delete', async () => {
    const failing = {
      ...storage,
      delete: (key: string) =>
        key.endsWith('B101') ? Promise.reject(new Error('storage down')) : storage.delete(key),
    };
    const deleted: DeletedAccountExport[] = [...listed].map(([id, row]) => ({
      id,
      environmentId: ENV,
      storageKey: row.storageKey,
    }));
    expect(
      await deleteExportObjects(failing, [
        ...deleted,
        { id: 'x', environmentId: ENV, storageKey: null },
      ]),
    ).toEqual([`${ENV}/account-exports/aexp_01M5CN0000000000000011B101`]);
    expect(await storage.get(`${ENV}/account-exports/aexp_01M5CN0000000000000011B100`)).toBeNull();
  });
});

describe('runAccountExportRetention (C253.4)', () => {
  it('expires the exports past their life and deletes their manifests', async () => {
    const result = await runAccountExportRetention(
      { db: tx, storage },
      store,
      new Date('2026-11-15T00:00:00.000Z'),
    );
    expect(result).toEqual({ expired: 1, objectsKept: 0 });
    expect(await storage.get(`${ENV}/account-exports/aexp_01M5CN0000000000000011B101`)).toBeNull();
    expect(
      await storage.get(`${ENV}/account-exports/aexp_01M5CN0000000000000011B100`),
    ).not.toBeNull();
  });
});
