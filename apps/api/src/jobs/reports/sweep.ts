/**
 * C74.3 (Workflow 6A Stage 3, owner `api-reports`): the `report-sweep`, which the repeatable-job
 * registry (`jobs/repeatable/index.ts`) schedules every 15 seconds in the worker. In batches with
 * `FOR UPDATE SKIP LOCKED`:
 *
 * - (a) it enqueues every claimable run whose `enqueued_at` is null or older than 5 minutes and
 *   sets `enqueued_at` (the outbox of C84.2, and the recovery of a lost enqueue). Each batch takes
 *   the environments in turn, and within one its budget-waiting runs last, then oldest
 *   `scheduled_for` first (R001), so no environment's backlog keeps another's runs waiting;
 * - (b) for every recurring report that is due, not paused, not redacted and without a pending or
 *   running scheduled run, it inserts one `scheduled` run and moves `next_run_at` to the first
 *   interval boundary after now, counted from the previous one (one catch-up run per report);
 * - (c) it calls `recoverPendingRescreens` (`jobs/reports/rescreen.ts`, `api-watchlists`).
 *
 * The signature and the deps are frozen by `foundation-6` (Stage 1b). Each step works in
 * batches; a failed enqueue clears its stamp so the next sweep tries again.
 */
import { newId } from '@openverify/contracts';
import {
  clearReportRunEnqueued,
  hasOpenScheduledRun,
  insertReportRun,
  lockDueRecurringReports,
  stampEnqueueableReportRuns,
  updateReportState,
  type Db,
} from '@openverify/db';
import type { ReportLimits } from '../../config.js';
import type { Clock, ReportRescreenQueue, ReportRunQueue } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';
import { nextBoundary } from '../../services/reports/reports.js';
import { recoverPendingRescreens, type RecoverPendingRescreens } from './rescreen.js';

export interface ReportSweepDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  /** (a): the `report-run` producer. */
  runs: ReportRunQueue;
  /** (c): the `report-rescreen` producer of `recoverPendingRescreens`. */
  rescreens: ReportRescreenQueue;
  limits: ReportLimits;
}

/** What one sweep did; counts only. */
export interface ReportSweepResult {
  /** (a) Runs enqueued. */
  enqueued: number;
  /** (b) Scheduled runs inserted. */
  scheduled: number;
  /** (c) Re-screens enqueued again. */
  rescreens: number;
  /** Enqueues that failed this run; each is logged and tried again on the next sweep. */
  failed: number;
}

export type RunReportSweep = (deps: ReportSweepDeps) => Promise<ReportSweepResult>;

export interface ReportSweepOptions {
  /** (c): the re-screen recovery (`recoverPendingRescreens`, `api-watchlists`) by default. */
  recover?: RecoverPendingRescreens | undefined;
  /** Rows per batch (500) and batches per sweep (10). */
  batchSize?: number | undefined;
  maxBatches?: number | undefined;
}

/** C74.3 (a): a run is enqueued again only once it has waited this long in the queue. */
export const REPORT_RUN_REENQUEUE_MS = 5 * 60_000;
const BATCH_SIZE = 500;
const MAX_BATCHES = 10;

/** The sweep with its recovery and batch sizes. */
export function createReportSweep(options: ReportSweepOptions = {}): RunReportSweep {
  const recover = options.recover ?? recoverPendingRescreens;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxBatches = options.maxBatches ?? MAX_BATCHES;
  return async (deps) => {
    const { db, clock, logger } = deps;
    const now = clock.now();
    let scheduled = 0;
    // (b) One scheduled run per due recurring report (F06), its next run past now.
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const count = await db.transaction(async (tx) => {
        const due = await lockDueRecurringReports(tx, { now, limit: batchSize });
        let inserted = 0;
        for (const report of due) {
          const nextRunAt = nextBoundary(report.nextRunAt, report.recurrenceIntervalDays, now);
          if (!(await hasOpenScheduledRun(tx, report.environmentId, report.reportId))) {
            await insertReportRun(tx, report.environmentId, {
              id: newId('rpr'),
              reportId: report.reportId,
              runType: 'scheduled',
              scheduledFor: now,
            });
            inserted += 1;
          }
          await updateReportState(tx, report.environmentId, report.reportId, { nextRunAt });
        }
        return { due: due.length, inserted };
      });
      scheduled += count.inserted;
      if (count.due < batchSize) {
        break;
      }
    }
    // (a) The outbox: every claimable run not enqueued in the last five minutes, fairly (R001).
    let enqueued = 0;
    let failed = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const stamped = await db.transaction((tx) =>
        stampEnqueueableReportRuns(tx, {
          now,
          enqueuedBefore: new Date(now.getTime() - REPORT_RUN_REENQUEUE_MS),
          limit: batchSize,
        }),
      );
      for (const run of stamped) {
        try {
          await deps.runs.enqueueReportRun(run);
          enqueued += 1;
        } catch {
          failed += 1;
          logger.warn({ reportId: run.reportId, runId: run.runId }, 'report run enqueue failed');
          await clearReportRunEnqueued(db, run.environmentId, run.runId);
        }
      }
      if (stamped.length < batchSize) {
        break;
      }
    }
    // (c) Re-screens whose enqueue was lost (V05).
    const recovered = await recover({ db, clock, logger, rescreens: deps.rescreens });
    return {
      enqueued,
      scheduled,
      rescreens: recovered.enqueued,
      failed: failed + recovered.failed,
    };
  };
}

/** C74.3: the sweep the repeatable-job registry schedules every 15 seconds. */
export const runReportSweep: RunReportSweep = createReportSweep();
