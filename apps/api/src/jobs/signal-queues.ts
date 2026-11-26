/**
 * C90.5, C107.1, C107.2 (Workflow 7A Stage 1b (S)): the `inquiry-signals` queue and its producer,
 * and the name and period of the `inquiry-signals-sweep` repeatable job.
 *
 * - `inquiry-signals`: one job per inquiry, its id the inquiry id, so an inquiry whose job is
 *   waiting, delayed or active is not added twice. The worker's processor is
 *   `processInquirySignals` (`jobs/signals/process.ts`, `api-signals`), with the keyring and the
 *   blind-index key.
 * - `inquiry-signals-sweep`: every 15 s, `runInquirySignalsSweep` (`jobs/signals/sweep.ts`,
 *   `api-signals`) enqueues the pending outbox rows, so a lost enqueue recovers.
 *
 * Jobs are removed when they complete or fail (as C85.4's): the outbox row is the record, and
 * BullMQ ignores an `add` under an id it still holds. Jobs carry ids only. Frozen by
 * `foundation-7a`; a change is a plan amendment.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type { InquirySignalsJob, InquirySignalsQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export const INQUIRY_SIGNALS_QUEUE = 'inquiry-signals';
export const INQUIRY_SIGNALS_JOB = 'inquiry-signals';

/** C107.1: the sweep's name (also its queue's and scheduler's) and period. */
export const INQUIRY_SIGNALS_SWEEP_QUEUE = 'inquiry-signals-sweep';
export const INQUIRY_SIGNALS_SWEEP_INTERVAL_MS = 15_000;

/**
 * A computation's database hiccups are retried with exponential backoff and jitter (about 5 s,
 * 10 s, 20 s, 40 s; provisional, as `report-run`'s); finished jobs are removed.
 */
export const INQUIRY_SIGNALS_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

export type ClosableInquirySignalsQueue = InquirySignalsQueue & { close(): Promise<void> };

export type InquirySignalsQueueOptions = { queue: JobQueue<InquirySignalsJob> } | BullQueueOptions;

/** The producer of `inquiry-signals`, over BullMQ or an injected queue. */
export function createInquirySignalsQueue(
  options: InquirySignalsQueueOptions,
): ClosableInquirySignalsQueue {
  // Opened on first use, so a process that never enqueues opens no Valkey connection.
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    async enqueueInquirySignals({ environmentId, inquiryId }) {
      if (!isId('env', environmentId) || !isId('inq', inquiryId)) {
        throw new TypeError('inquiry-signals jobs need an env_ and an inq_ id');
      }
      queue ??= createBullQueue<InquirySignalsJob>(
        INQUIRY_SIGNALS_QUEUE,
        options as BullQueueOptions,
      );
      await queue.add(
        INQUIRY_SIGNALS_JOB,
        { environmentId, inquiryId },
        { ...INQUIRY_SIGNALS_JOB_OPTIONS, jobId: inquiryId },
      );
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}
