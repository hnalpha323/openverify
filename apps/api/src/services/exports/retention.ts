/**
 * C166.1, C166.5, C174.3 (Workflow 9B; decision 43; review P24): an export's file is kept
 * `EXPORT_LIMITS['retention-hours']` (24) after it completed, then deleted, and the export reads
 * `expired`, keeping its count and times; a bulk job's uploaded CSV is deleted when the job ends, and
 * this step deletes the CSV of a job that ended or is older than 24 hours (a failed, retried or killed
 * job included; a job that had not ended then fails with `report_bulk_expired`, since its CSV is
 * gone). `export-sweep` (60 s, `jobs/exports/sweep.ts`) and the C16 pass both run it, as Phase 8's
 * case exports (`services/cases/exports/retention.ts`). Owner: `api-exports`.
 *
 * The object is deleted first and the row changed after, so `expired` means the file is gone; a delete
 * that fails leaves the row as it was and counts as a failure the next pass retries.
 */
import { EXPORT_LIMITS } from '@openverify/core';
import {
  dropReportBulkFile,
  expireExportRow,
  listExpiredExports,
  listReportBulkFilesDue,
  type Db,
} from '@openverify/db';
import type { FileStorage } from '../../ports.js';

export interface ExportRetentionReport {
  /** Exports whose file was deleted and which read `expired`. */
  expiredExports: number;
  /** Export files whose delete failed; the next pass retries them. */
  failedExportDeletes: number;
  /** Bulk jobs whose uploaded CSV was deleted. */
  deletedReportBulkFiles: number;
  /** Bulk CSVs whose delete failed; the next pass retries them. */
  failedReportBulkFileDeletes: number;
}

export type RunExportRetention = (
  deps: { db: Db; storage: FileStorage },
  options: { now: Date; limit: number },
) => Promise<ExportRetentionReport>;

const DAY_MS = EXPORT_LIMITS['retention-hours'] * 60 * 60 * 1000;

export const runExportRetention: RunExportRetention = async (deps, options) => {
  const report: ExportRetentionReport = {
    expiredExports: 0,
    failedExportDeletes: 0,
    deletedReportBulkFiles: 0,
    failedReportBulkFileDeletes: 0,
  };
  for (const expired of await listExpiredExports(deps.db, options.now, options.limit)) {
    try {
      await deps.storage.delete(expired.storageKey);
    } catch {
      report.failedExportDeletes += 1;
      continue;
    }
    if (await expireExportRow(deps.db, expired.environmentId, expired.id, options.now)) {
      report.expiredExports += 1;
    }
  }
  const dayAgo = new Date(options.now.getTime() - DAY_MS);
  for (const file of await listReportBulkFilesDue(deps.db, dayAgo, options.limit)) {
    try {
      await deps.storage.delete(file.storageKey);
    } catch {
      report.failedReportBulkFileDeletes += 1;
      continue;
    }
    await dropReportBulkFile(deps.db, file.environmentId, file.id, options.now);
    report.deletedReportBulkFiles += 1;
  }
  return report;
};
