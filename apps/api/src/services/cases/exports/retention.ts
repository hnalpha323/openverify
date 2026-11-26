/**
 * C138.1, C143.1 (Workflow 8B (F); decision 69): an export's file is kept 24 hours, then deleted and
 * the export reads `expired`, keeping its count and times. The `case-export-sweep` (60 s,
 * `jobs/cases/export-sweep.ts`) and the C16 pass both run this step. Owner `api-case-files`.
 *
 * The object is deleted first and the row marked after, so `expired` means the file is gone; a delete
 * that fails leaves the export `completed` and counts as a failure the next pass retries.
 */
import { expireCaseExportRow, listExpiredCaseExports, type Db } from '@openverify/db';
import type { FileStorage } from '../../../ports.js';

export interface CaseExportRetentionReport {
  /** Exports whose file was deleted and which read `expired`. */
  expiredCaseExports: number;
  /** Files whose delete failed; the next pass retries them. */
  failedCaseExportDeletes: number;
}

export async function runCaseExportRetention(
  deps: { db: Db; storage: FileStorage },
  options: { now: Date; limit: number },
): Promise<CaseExportRetentionReport> {
  const report: CaseExportRetentionReport = { expiredCaseExports: 0, failedCaseExportDeletes: 0 };
  for (const expired of await listExpiredCaseExports(deps.db, options.now, options.limit)) {
    try {
      await deps.storage.delete(expired.storageKey);
    } catch {
      report.failedCaseExportDeletes += 1;
      continue;
    }
    if (await expireCaseExportRow(deps.db, expired.environmentId, expired.id)) {
      report.expiredCaseExports += 1;
    }
  }
  return report;
}
