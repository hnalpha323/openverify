/**
 * C166.1, C166.5, C174.3 (Workflow 9B Stage 1b (X)): the export and bulk report queues and the export
 * sweep.
 *
 * - `export`: one job per `exports` row to cut (`processExport`, `jobs/exports/export.ts`).
 * - `report-bulk`: one job per `report_bulk_jobs` row to run (`processReportBulk`,
 *   `jobs/reports/report-bulk.ts`).
 * - `export-sweep`: every 60 seconds (`jobs/repeatable/index.ts`' `exportRepeatableJobs`, whenever the
 *   worker runs exports), calling `runExportSweep` (`jobs/exports/sweep.ts`): expired export files and
 *   the uploaded CSVs of ended or day-old bulk jobs deleted, and unfinished rows enqueued again.
 *
 * Postgres is the record, jobs carry ids alone, each job's id is its row's (a repeated request is one
 * job), and a job is removed on completion and on failure (`WORKFLOW_JOB_OPTIONS`, as Phase 8's
 * `case-export`; the sweep enqueues again what a failed or killed job left unfinished). Frozen by
 * `foundation-9b`; the processors and the sweep are `api-exports`'.
 */
import { isId } from '@openverify/contracts';
import type { ExportJob, ExportQueue, ReportBulkJob, ReportBulkQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';
import { WORKFLOW_JOB_OPTIONS } from './workflow-queues.js';

export const EXPORT_QUEUE = 'export';
export const REPORT_BULK_QUEUE = 'report-bulk';

/** C174.3: the sweep's name (also its queue's and scheduler's) and period. */
export const EXPORT_SWEEP_QUEUE = 'export-sweep';
export const EXPORT_SWEEP_INTERVAL_MS = 60_000;

export type ClosableExportQueue = ExportQueue & { close(): Promise<void> };
export type ClosableReportBulkQueue = ReportBulkQueue & { close(): Promise<void> };

/** One producer over BullMQ or an injected queue, opened on first use, whose job id is `jobIdOf`. */
function producer<Job extends { environmentId: string }>(
  name: string,
  options: { queue: JobQueue<Job> } | BullQueueOptions,
  isValid: (job: Job) => boolean,
  jobIdOf: (job: Job) => string,
): { enqueue: (job: Job) => Promise<void>; close: () => Promise<void> } {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    enqueue: async (job) => {
      if (!isId('env', job.environmentId) || !isValid(job)) {
        throw new TypeError(`${name} jobs carry an env_ id and their row's id`);
      }
      queue ??= createBullQueue<Job>(name, options as BullQueueOptions);
      await queue.add(name, job, { ...WORKFLOW_JOB_OPTIONS, jobId: jobIdOf(job) });
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}

/** The producer of `export`, over BullMQ or an injected queue, opened on first use. */
export function createExportQueue(
  options: { queue: JobQueue<ExportJob> } | BullQueueOptions,
): ClosableExportQueue {
  const queue = producer<ExportJob>(
    EXPORT_QUEUE,
    options,
    ({ exportId }) => isId('exp', exportId),
    ({ exportId }) => exportId,
  );
  return {
    enqueueExport: ({ environmentId, exportId }) => queue.enqueue({ environmentId, exportId }),
    close: queue.close,
  };
}

/** The producer of `report-bulk`, over BullMQ or an injected queue, opened on first use. */
export function createReportBulkQueue(
  options: { queue: JobQueue<ReportBulkJob> } | BullQueueOptions,
): ClosableReportBulkQueue {
  const queue = producer<ReportBulkJob>(
    REPORT_BULK_QUEUE,
    options,
    ({ reportBulkJobId }) => isId('rbulk', reportBulkJobId),
    ({ reportBulkJobId }) => reportBulkJobId,
  );
  return {
    enqueueReportBulk: ({ environmentId, reportBulkJobId }) =>
      queue.enqueue({ environmentId, reportBulkJobId }),
    close: queue.close,
  };
}
