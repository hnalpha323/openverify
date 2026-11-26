/**
 * C253 (Workflow 11B, `dsar-export`): the access export's store ports (`service.ts`, `cut.ts`,
 * `deletion.ts`) over the `account_exports` repository (`@openverify/db`): one adapter, so the
 * service, the job and the deletion hooks read and write the same rows the same way.
 */
import {
  claimPendingAccountExport,
  deleteAccountExportsListing,
  expireAccountExports,
  getAccountExportRecord,
  hasPendingAccountExport,
  insertPendingAccountExport,
  lockAccountForExport,
  markAccountExportFailed,
  markAccountExportReady,
  type AccountExportRecord,
} from '@openverify/db';
import type { AccountExportJobStore } from './cut.js';
import type { AccountExportDeletionStore } from './deletion.js';
import type { AccountExportRow, AccountExportStore } from './service.js';

/** The three ports over one table. */
export type AccountExportStores = AccountExportStore &
  AccountExportJobStore &
  AccountExportDeletionStore;

/** A row as the ports read it: ids, counts, times and the object's keys; never content. */
export function accountExportRowOf(record: AccountExportRecord): AccountExportRow {
  return {
    id: record.id,
    environmentId: record.environmentId,
    accountId: record.accountId,
    status: record.status,
    createdAt: record.createdAt,
    readyAt: record.readyAt,
    expiresAt: record.expiresAt,
    itemCount: record.itemCount,
    byteCount: record.byteCount,
    errorCode: record.errorCode,
    storageKey: record.storageKey,
    wrappedDek: record.wrappedDek,
  };
}

const rowOrNull = (record: AccountExportRecord | null): AccountExportRow | null =>
  record === null ? null : accountExportRowOf(record);

/** The ports over `account_exports`. */
export const accountExportStores: AccountExportStores = {
  lockAccount: lockAccountForExport,
  hasPendingExport: hasPendingAccountExport,
  createPendingExport: async (tx, environmentId, input) =>
    accountExportRowOf(await insertPendingAccountExport(tx, environmentId, input)),
  getExport: async (db, environmentId, id) =>
    rowOrNull(await getAccountExportRecord(db, environmentId, id)),
  claimExport: async (tx, environmentId, id) =>
    rowOrNull(await claimPendingAccountExport(tx, environmentId, id)),
  completeExport: async (tx, environmentId, id, completion) =>
    rowOrNull(await markAccountExportReady(tx, environmentId, id, completion)),
  failExport: markAccountExportFailed,
  deleteExportsListing: deleteAccountExportsListing,
  expireExports: expireAccountExports,
};
