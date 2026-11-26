/**
 * C143.1 (Workflow 8B (F)): `case-export-sweep`, every 60 seconds: expired export files deleted, as
 * the C16 pass does (`services/cases/exports/retention.ts`), in batches of 500. Owner
 * `api-case-files`; `foundation-8b` registered it with the case sweeps (`jobs/repeatable/index.ts`).
 * A delete that failed is logged by count alone and retried by the next run.
 */
import type { Db } from '@openverify/db';
import type { Clock, FileStorage } from '../../ports.js';
import { runCaseExportRetention } from '../../services/cases/exports/retention.js';
import type { WorkerLogger } from '../logger.js';

export interface CaseExportSweepDeps {
  db: Db;
  storage: FileStorage;
  clock: Clock;
  logger: WorkerLogger;
}

/** Expired files per run. */
export const CASE_EXPORT_SWEEP_BATCH = 500;

export async function runCaseExportSweep(deps: CaseExportSweepDeps): Promise<void> {
  const report = await runCaseExportRetention(deps, {
    now: deps.clock.now(),
    limit: CASE_EXPORT_SWEEP_BATCH,
  });
  if (report.failedCaseExportDeletes > 0) {
    deps.logger.warn(
      { failed: report.failedCaseExportDeletes },
      'expired case export files could not be deleted',
    );
  }
}
