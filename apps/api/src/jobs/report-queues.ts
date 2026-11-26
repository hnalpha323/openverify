/**
 * C74.1, C74.4, C85.4 (Phase 6, Workflow 6A Stage 1b): the two report queues and their producers.
 *
 * - `report-run`: one job per run, its id the run id (`rpr_...`), so a run whose job is waiting,
 *   delayed or active is not added twice. The worker's processor is `processReportRun`
 *   (`jobs/reports/run.ts`, `api-reports`).
 * - `report-rescreen`: one job per applied sync, its id `rescreen-<sync id>` (BullMQ ids may not
 *   contain `:`). The worker's processor is `processReportRescreen` (`jobs/reports/rescreen.ts`,
 *   `api-watchlists`).
 *
 * Both remove their jobs when they complete or fail (V02, V05): the run row and the sync's
 * `rescreen_state` are the record, and BullMQ ignores an `add` under an id it still holds, a
 * finished job included, so a kept job would turn every later re-add (a budget wait, a crashed
 * run, a lost re-screen) into a no-op. The sweep enqueues again whatever is still due. Jobs carry
 * ids only. Frozen by `foundation-6`; a change is a plan amendment.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type {
  ReportRescreenJob,
  ReportRescreenQueue,
  ReportRunJob,
  ReportRunQueue,
} from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export const REPORT_RUN_QUEUE = 'report-run';
export const REPORT_RUN_JOB = 'report-run';
export const REPORT_RESCREEN_QUEUE = 'report-rescreen';
export const REPORT_RESCREEN_JOB = 'report-rescreen';

/** C74.3: the sweep's name (also its queue's and scheduler's) and period. */
export const REPORT_SWEEP_QUEUE = 'report-sweep';
export const REPORT_SWEEP_INTERVAL_MS = 15_000;

/** C76.2 (F17): the refresh tick's name and period, run with `OPENVERIFY_WATCHLIST_REFRESH=true`. */
export const WATCHLISTS_REFRESH_QUEUE = 'watchlists-refresh';
export const WATCHLISTS_REFRESH_INTERVAL_MS = 15 * 60_000;

/**
 * A run's database and provider hiccups are retried with exponential backoff and jitter (about
 * 5 s, 10 s, 20 s, 40 s; provisional, as `process-verification`'s); the run framework ends the run
 * `errored` on the last attempt (C74.1). Finished jobs are removed.
 */
export const REPORT_RUN_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

/** A re-screen is retried three times (provisional); the sweep enqueues it again while pending. */
export const REPORT_RESCREEN_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

/** The job id of a sync's re-screen. */
export const reportRescreenJobId = (syncId: number): string => `rescreen-${String(syncId)}`;

export type ClosableReportRunQueue = ReportRunQueue & { close(): Promise<void> };
export type ClosableReportRescreenQueue = ReportRescreenQueue & { close(): Promise<void> };

export type ReportRunQueueOptions = { queue: JobQueue<ReportRunJob> } | BullQueueOptions;
export type ReportRescreenQueueOptions = { queue: JobQueue<ReportRescreenJob> } | BullQueueOptions;

/**
 * The queue of `options`, or one BullMQ queue named `name` opened on first use, so a process that
 * never enqueues (most API requests, a CLI that applied nothing) opens no Valkey connection.
 */
function lazyQueue<Data>(
  name: string,
  options: { queue: JobQueue<Data> } | BullQueueOptions,
): { get(): JobQueue<Data>; close(): Promise<void> } {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    get() {
      queue ??= createBullQueue<Data>(name, options as BullQueueOptions);
      return queue;
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}

/** The producer of `report-run`, over BullMQ or an injected queue. */
export function createReportRunQueue(options: ReportRunQueueOptions): ClosableReportRunQueue {
  const queue = lazyQueue(REPORT_RUN_QUEUE, options);
  return {
    async enqueueReportRun({ environmentId, reportId, runId }) {
      if (!isId('env', environmentId) || !isId('rep', reportId) || !isId('rpr', runId)) {
        throw new TypeError('report-run jobs need an env_, a rep_ and an rpr_ id');
      }
      await queue
        .get()
        .add(
          REPORT_RUN_JOB,
          { environmentId, reportId, runId },
          { ...REPORT_RUN_JOB_OPTIONS, jobId: runId },
        );
    },
    close: () => queue.close(),
  };
}

/** The producer of `report-rescreen`, over BullMQ or an injected queue. */
export function createReportRescreenQueue(
  options: ReportRescreenQueueOptions,
): ClosableReportRescreenQueue {
  const queue = lazyQueue(REPORT_RESCREEN_QUEUE, options);
  return {
    async enqueueReportRescreen({ syncId }) {
      if (!Number.isSafeInteger(syncId) || syncId < 1) {
        throw new TypeError('report-rescreen jobs need a watchlist sync id');
      }
      await queue
        .get()
        .add(
          REPORT_RESCREEN_JOB,
          { syncId },
          { ...REPORT_RESCREEN_JOB_OPTIONS, jobId: reportRescreenJobId(syncId) },
        );
    },
    close: () => queue.close(),
  };
}
