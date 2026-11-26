/**
 * C150.9, C152.2, C174.3 (Workflow 9A Stage 1b (S)): the flow's queue and repeatable job.
 *
 * - `flow-signal-snapshot`: one job per branch entry, its id `<inquiry id>-<seq>`, enqueued by
 *   `requestSignalSnapshot` (`flow-actions/signal-snapshot.ts`) once the transaction that entered
 *   the branch commits. The worker's processor is `processFlowSignalSnapshot`
 *   (`jobs/flow/signal-snapshot.ts`, `api-flow-actions`), with the deps the `inquiry-signals`
 *   processor receives.
 * - `flow-action-sweep`: every 15 s (`jobs/repeatable/flow-actions.ts`, `api-flow-actions`), ends the
 *   `run_workflow` waits past their timeout and the branch waits past their deadline.
 *
 * Jobs carry ids and registry names only, and are removed when they complete or fail. Frozen by
 * `foundation-9a`; a change is a plan amendment.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type { FlowSignalSnapshotJob, FlowSignalSnapshotQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export const FLOW_SIGNAL_SNAPSHOT_QUEUE = 'flow-signal-snapshot';
export const FLOW_SIGNAL_SNAPSHOT_JOB = 'flow-signal-snapshot';

/** C152.2, C150.9: the sweep's name (also its queue's and scheduler's) and period. */
export const FLOW_ACTION_SWEEP_QUEUE = 'flow-action-sweep';
export const FLOW_ACTION_SWEEP_INTERVAL_MS = 15_000;

/**
 * A snapshot reads stored facts only, so a database hiccup is retried a few times quickly: the
 * branch waits at most 30 s (C150.5), after which a null follows `onNull` (provisional).
 */
export const FLOW_SIGNAL_SNAPSHOT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

/** A branch entry's snapshot job id: one per entry. */
export const flowSignalSnapshotJobId = (
  job: Pick<FlowSignalSnapshotJob, 'inquiryId' | 'stepRecordSeq'>,
) => `${job.inquiryId}-${String(job.stepRecordSeq)}`;

export type ClosableFlowSignalSnapshotQueue = FlowSignalSnapshotQueue & { close(): Promise<void> };

export type FlowSignalSnapshotQueueOptions =
  { queue: JobQueue<FlowSignalSnapshotJob> } | BullQueueOptions;

/** The producer of `flow-signal-snapshot`, over BullMQ or an injected queue. */
export function createFlowSignalSnapshotQueue(
  options: FlowSignalSnapshotQueueOptions,
): ClosableFlowSignalSnapshotQueue {
  // Opened on first use, so a process that never enqueues opens no Valkey connection.
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    async enqueueFlowSignalSnapshot(job) {
      if (
        !isId('env', job.environmentId) ||
        !isId('inq', job.inquiryId) ||
        !Number.isInteger(job.stepRecordSeq) ||
        job.stepRecordSeq < 1
      ) {
        throw new TypeError(
          'flow-signal-snapshot jobs need an env_ and an inq_ id and a step record',
        );
      }
      queue ??= createBullQueue<FlowSignalSnapshotJob>(
        FLOW_SIGNAL_SNAPSHOT_QUEUE,
        options as BullQueueOptions,
      );
      await queue.add(
        FLOW_SIGNAL_SNAPSHOT_JOB,
        {
          environmentId: job.environmentId,
          inquiryId: job.inquiryId,
          stepRecordSeq: job.stepRecordSeq,
          names: [...job.names],
        },
        { ...FLOW_SIGNAL_SNAPSHOT_JOB_OPTIONS, jobId: flowSignalSnapshotJobId(job) },
      );
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}
