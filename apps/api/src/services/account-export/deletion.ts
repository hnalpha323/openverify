/**
 * C253.4 (Workflow 11B, `dsar-export`): an export never outlives what it lists.
 *
 * - Any redaction or retention deletion that touches an item an export lists (the account, an
 *   inquiry, a session, a verification, a file, a report, a transaction, a consent record, a share,
 *   a case, a list match or item, a signal's session, a device, an integrity verdict) deletes the
 *   exports listing it **first**, in its own transaction (`deleteExportsListingInTx`, called by
 *   `foundation-11b`'s hooks at the start of each cascade and drain), so no export of the item is
 *   served after the deletion commits. The manifests' objects are deleted after the commit
 *   (`deleteExportObjects`); one a storage failure keeps is ciphertext whose wrapped data key went
 *   with its row, so nothing can read it, and no sweep of objects without rows is added (KP10-54's
 *   decision, as for a replaced upload; the failure is logged by key by the caller).
 * - The retention pass (C16) expires each `ready` export past its `expires-at` and deletes its
 *   manifest (`runAccountExportRetention`); an expired export keeps its counts and times, never its
 *   object.
 */
import type { Db } from '@openverify/db';
import type { FileStorage } from '../../ports.js';

/** An export a deletion removed, and its manifest's object, if it had one. */
export interface DeletedAccountExport {
  id: string;
  environmentId: string;
  storageKey: string | null;
}

/** The deletion side of the store (the repository implements it). */
export interface AccountExportDeletionStore {
  /** Deletes every export of the environment that lists one of `itemIds`. */
  deleteExportsListing(
    tx: Db,
    environmentId: string,
    itemIds: readonly string[],
  ): Promise<DeletedAccountExport[]>;
  /** Marks `ready` exports past `expires-at` `expired` (their object key cleared), at most `limit`. */
  expireExports(db: Db, now: Date, limit: number): Promise<DeletedAccountExport[]>;
}

/** Deletes, in the caller's transaction, the exports listing any of `itemIds`. */
export async function deleteExportsListingInTx(
  tx: Db,
  store: AccountExportDeletionStore,
  environmentId: string,
  itemIds: readonly string[],
): Promise<DeletedAccountExport[]> {
  if (itemIds.length === 0) {
    return [];
  }
  return store.deleteExportsListing(tx, environmentId, [...new Set(itemIds)]);
}

/** Deletes the deleted exports' manifests from storage (after the commit); failures are kept. */
export async function deleteExportObjects(
  storage: FileStorage,
  deleted: readonly DeletedAccountExport[],
): Promise<string[]> {
  const kept: string[] = [];
  for (const { storageKey } of deleted) {
    if (storageKey === null) {
      continue;
    }
    try {
      await storage.delete(storageKey);
    } catch {
      kept.push(storageKey);
    }
  }
  return kept;
}

/** C253.4: the retention pass's drain: expires the exports past their life and deletes their objects. */
export async function runAccountExportRetention(
  deps: { db: Db; storage: FileStorage },
  store: AccountExportDeletionStore,
  now: Date,
  limit = ACCOUNT_EXPORT_RETENTION_BATCH,
): Promise<{ expired: number; objectsKept: number }> {
  const expired = await store.expireExports(deps.db, now, limit);
  const kept = await deleteExportObjects(deps.storage, expired);
  return { expired: expired.length, objectsKept: kept.length };
}

/** Exports one retention pass expires, at most (the C16 drains' batch). */
export const ACCOUNT_EXPORT_RETENTION_BATCH = 500;
