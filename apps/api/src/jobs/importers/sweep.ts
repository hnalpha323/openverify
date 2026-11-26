/**
 * C100.2, C107.1 (Workflow 7B): the `list-import-sweep`, every 15 s: enqueues the pending imports,
 * so a lost enqueue recovers. A job id is its importer's, so an import still queued or running is
 * never added twice. Owner: `api-importers`.
 */
import { listPendingImporters, markImportersEnqueued, type Db } from '@openverify/db';
import type { Clock, ListImportQueue } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';

/** A row enqueued this recently is left to its job; an older one is enqueued again. */
export const LIST_IMPORT_REENQUEUE_AFTER_MS = 2 * 60_000;
/** The rows one tick takes, oldest first. */
export const LIST_IMPORT_SWEEP_LIMIT = 100;

export interface ListImportSweepDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  imports: ListImportQueue;
}

export type RunListImportSweep = (deps: ListImportSweepDeps) => Promise<void>;

export const runListImportSweep: RunListImportSweep = async ({ db, clock, logger, imports }) => {
  const now = clock.now();
  const rows = await listPendingImporters(db, {
    olderThan: new Date(now.getTime() - LIST_IMPORT_REENQUEUE_AFTER_MS),
    limit: LIST_IMPORT_SWEEP_LIMIT,
  });
  const enqueued: { environmentId: string; id: string }[] = [];
  for (const { environmentId, id } of rows) {
    const row = [{ environmentId, id }];
    // Recorded before the job exists: a write after it could meet the job's SKIP LOCKED.
    await markImportersEnqueued(db, row, now);
    try {
      await imports.enqueueListImport({ environmentId, importerId: id });
    } catch (error) {
      await markImportersEnqueued(db, row, null);
      throw error;
    }
    enqueued.push({ environmentId, id });
  }
  if (enqueued.length > 0) {
    logger.info({ enqueued: enqueued.length }, 'list import sweep');
  }
};
