/**
 * C166.1, C166.5, C174.3 (Workflow 9B): `export-sweep`, every 60 seconds: expired export files and the
 * uploaded CSVs of ended or day-old bulk jobs deleted (`runExportRetention`,
 * `services/exports/retention.ts`, which the C16 pass also runs), and the exports and bulk jobs left
 * unfinished (a lost enqueue, a stopped worker) enqueued again; the job's claim decides whether one
 * still running is taken (its 15-minute lease). Owner: `api-exports`. Counts only are logged.
 */
import { listUnfinishedExports, listUnfinishedReportBulkJobs, type Db } from '@openverify/db';
import type { Clock, ExportQueue, FileStorage, ReportBulkQueue } from '../../ports.js';
import { runExportRetention } from '../../services/exports/retention.js';
import type { WorkerLogger } from '../logger.js';

/** What one sweep reads. */
export interface ExportSweepDeps {
  db: Db;
  storage: FileStorage;
  clock: Clock;
  logger: WorkerLogger;
  /** The `export` producer, for an export left unfinished. */
  exports: ExportQueue;
  /** The `report-bulk` producer, for a bulk job left unfinished. */
  reportBulk: ReportBulkQueue;
}

/** What one sweep did: counts only. */
export interface ExportSweepResult {
  expiredExports: number;
  deletedReportBulkFiles: number;
  /** Exports and bulk jobs enqueued again. */
  requeued: number;
  /** Deletes that failed; the next sweep retries them. */
  failedDeletes: number;
}

export type RunExportSweep = (deps: ExportSweepDeps) => Promise<ExportSweepResult>;

/** The `reason` the stub failed with, kept for the worker's tests. */
export const EXPORT_SWEEP_NOT_BUILT = 'export_sweep_not_built';

/** Files, exports and jobs per sweep. */
export const EXPORT_SWEEP_BATCH = 500;

/** An unfinished export or job younger than this is its first job's, not yet the sweep's. */
export const EXPORT_REQUEUE_AFTER_MS = 60_000;

export const runExportSweep: RunExportSweep = async (deps) => {
  const now = deps.clock.now();
  const retention = await runExportRetention(deps, { now, limit: EXPORT_SWEEP_BATCH });
  const before = new Date(now.getTime() - EXPORT_REQUEUE_AFTER_MS);
  let requeued = 0;
  for (const left of await listUnfinishedExports(deps.db, before, EXPORT_SWEEP_BATCH)) {
    await deps.exports.enqueueExport({ environmentId: left.environmentId, exportId: left.id });
    requeued += 1;
  }
  for (const left of await listUnfinishedReportBulkJobs(deps.db, before, EXPORT_SWEEP_BATCH)) {
    await deps.reportBulk.enqueueReportBulk({
      environmentId: left.environmentId,
      reportBulkJobId: left.id,
    });
    requeued += 1;
  }
  const failedDeletes = retention.failedExportDeletes + retention.failedReportBulkFileDeletes;
  if (failedDeletes > 0) {
    deps.logger.warn({ failed: failedDeletes }, 'expired export files could not be deleted');
  }
  return {
    expiredExports: retention.expiredExports,
    deletedReportBulkFiles: retention.deletedReportBulkFiles,
    requeued,
    failedDeletes,
  };
};
