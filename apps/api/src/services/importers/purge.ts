/**
 * C100.2 (Workflow 7B; C16 pass): deletes each importer's encrypted object once it is due, 7 days
 * after the import ended or sooner for a list that keeps its items for less. The object goes first:
 * if the storage refuses, the row still names it and a later pass tries again. Owner:
 * `api-importers`.
 */
import {
  listImportObjectsDue,
  markImportObjectDeleted,
  type Db,
  type DeleteOptions,
} from '@openverify/db';
import type { FileStorage } from '../../ports.js';

export interface PurgeImportObjectsOptions {
  db: Db;
  storage: FileStorage;
}

/** Returns how many objects went in this batch; 0 ends the pass's drain. */
export type PurgeExpiredImportObjects = (
  deps: PurgeImportObjectsOptions,
  options: DeleteOptions,
) => Promise<number>;

export const purgeExpiredImportObjects: PurgeExpiredImportObjects = async (
  { db, storage },
  options,
) => {
  const due = await listImportObjectsDue(db, options);
  const at = options.now ?? new Date();
  for (const { id, environmentId, storageKey } of due) {
    await storage.delete(storageKey);
    await markImportObjectDeleted(db, environmentId, id, at);
  }
  return due.length;
};
