/**
 * C163.2, C163.4, C174.3 (Workflow 9B Stage 1b (A)): the analytics repeatable job and queue.
 *
 * - `analytics-rollup`: every 5 minutes (`jobs/repeatable/index.ts`' `analyticsRepeatableJobs`,
 *   whenever the worker runs analytics), calling `runAnalyticsRollup` (`jobs/analytics/rollup.ts`,
 *   `api-analytics`): the dirty days since the watermark, recomputed whole, each in one transaction.
 * - `analytics-rebuild`: one job per environment whose open days must be recomputed in its current
 *   reporting zone, processed by `processAnalyticsRebuild` (`jobs/analytics/rebuild.ts`,
 *   `api-analytics`); the rollup pass holds the producer.
 *
 * Jobs carry an environment id only and are removed when they complete or fail. Frozen by
 * `foundation-9b`; a change is a plan amendment.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type { AnalyticsRebuildJob, AnalyticsRebuildQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

/** C163.4: the refresh's name (also its queue's and scheduler's) and period. */
export const ANALYTICS_ROLLUP_QUEUE = 'analytics-rollup';
export const ANALYTICS_ROLLUP_INTERVAL_MS = 5 * 60_000;

export const ANALYTICS_REBUILD_QUEUE = 'analytics-rebuild';
export const ANALYTICS_REBUILD_JOB = 'analytics-rebuild';

/**
 * A rebuild reads and writes stored rows only, so a database hiccup is retried a few times; a job
 * that still fails is dropped, and the next zone check of the rollup pass queues it again.
 */
export const ANALYTICS_REBUILD_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

export type ClosableAnalyticsRebuildQueue = AnalyticsRebuildQueue & { close(): Promise<void> };

export type AnalyticsRebuildQueueOptions =
  { queue: JobQueue<AnalyticsRebuildJob> } | BullQueueOptions;

/** The producer of `analytics-rebuild`, over BullMQ or an injected queue. */
export function createAnalyticsRebuildQueue(
  options: AnalyticsRebuildQueueOptions,
): ClosableAnalyticsRebuildQueue {
  // Opened on first use, so a process that never enqueues opens no Valkey connection.
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    async enqueueAnalyticsRebuild(job) {
      if (!isId('env', job.environmentId)) {
        throw new TypeError('analytics-rebuild jobs need an env_ id');
      }
      queue ??= createBullQueue<AnalyticsRebuildJob>(
        ANALYTICS_REBUILD_QUEUE,
        options as BullQueueOptions,
      );
      await queue.add(
        ANALYTICS_REBUILD_JOB,
        { environmentId: job.environmentId },
        ANALYTICS_REBUILD_JOB_OPTIONS,
      );
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}
