/**
 * C251.1, C251.4 (Phase 11, Workflow 11B Stage 2, `quotas`; KP11-17, KP10-27): the worker's quota
 * passes over every capped queue the worker holds a producer for.
 *
 * - `quota-sweep` (every {@link QUOTA_SWEEP_INTERVAL_MS}): C251.1's fair sweep of each queue in turn
 *   (`sweepQueue`, `services/quotas/admission.ts`), admitting held work as slots free, with the
 *   metrics and the at-cap warn line of C251.4.
 * - `quota-recovery` (every {@link QUOTA_RECOVERY_INTERVAL_MS}): admitted work whose enqueue after the
 *   commit was lost is enqueued again under its own job id once it is older than
 *   {@link QUOTA_RECOVERY_GRACE_MS} (`recoverLostWork`), never held work (the cap holds it back).
 *
 * Each queue's pass is its own: a queue whose pass fails is logged by its name (never the error's
 * message) and the other queues are still swept.
 */
import type { CappedQueue } from '@openverify/contracts';
import {
  recoverLostWork,
  sweepQueue,
  type AdmissionDeps,
  type LostRows,
  type QueueRows,
  type QueueSweepResult,
  type RecoveryResult,
} from '../services/quotas/admission.js';
import type { RepeatableJob } from '../worker.js';

export const QUOTA_SWEEP_QUEUE = 'quota-sweep';
export const QUOTA_RECOVERY_QUEUE = 'quota-recovery';
/** C251.1: the sweep's tick (ours, provisional: the 15 s of Phase 7's and Phase 8's outbox sweeps). */
export const QUOTA_SWEEP_INTERVAL_MS = 15_000;
/** The recovery pass's tick (the repair sweep's minute). */
export const QUOTA_RECOVERY_INTERVAL_MS = 60_000;
/** How long admitted, unfinished work waits before it is taken to have lost its job (the repair sweep's two minutes). */
export const QUOTA_RECOVERY_GRACE_MS = 2 * 60_000;

/** One capped queue the worker admits: its rows, its lost rows when it has any, and its producer. */
export interface AdmissionQueue<J> {
  readonly rows: QueueRows<J>;
  readonly lost?: LostRows<J> | undefined;
  enqueue(job: J): Promise<void>;
}

/** An {@link AdmissionQueue} with its job type closed over, so queues of different jobs share a list. */
export interface QuotaQueuePass {
  readonly queue: CappedQueue;
  sweep(deps: AdmissionDeps): Promise<QueueSweepResult>;
  /** Null for a queue without lost rows. */
  readonly recover:
    ((deps: Pick<AdmissionDeps, 'db' | 'clock' | 'logger'>) => Promise<RecoveryResult>) | null;
}

/** Closes `queue` over its job type. */
export function quotaQueuePass<J>(queue: AdmissionQueue<J>): QuotaQueuePass {
  const enqueue = (job: J) => queue.enqueue(job);
  const { lost } = queue;
  return {
    queue: queue.rows.queue,
    sweep: (deps) => sweepQueue(deps, queue.rows, enqueue),
    recover:
      lost === undefined
        ? null
        : (deps) => recoverLostWork(deps, lost, enqueue, { graceMs: QUOTA_RECOVERY_GRACE_MS }),
  };
}

/** One sweep tick: one result per queue swept, and the queues whose pass failed. */
export interface QuotaSweepResult {
  readonly queues: readonly QueueSweepResult[];
  readonly errors: readonly CappedQueue[];
}

/** One recovery tick. */
export interface QuotaRecoveryResult {
  readonly queues: readonly RecoveryResult[];
  readonly errors: readonly CappedQueue[];
}

/** C251.1's fair sweep over `queues`, one queue after another; a queue's failure is logged and the rest go on. */
export async function runQuotaSweep(
  deps: AdmissionDeps,
  queues: readonly QuotaQueuePass[],
): Promise<QuotaSweepResult> {
  const results: QueueSweepResult[] = [];
  const errors: CappedQueue[] = [];
  for (const pass of queues) {
    try {
      results.push(await pass.sweep(deps));
    } catch (error) {
      errors.push(pass.queue);
      deps.logger.error(
        { queue: QUOTA_SWEEP_QUEUE, admittedQueue: pass.queue, error: (error as Error).name },
        'quota sweep of a queue failed',
      );
    }
  }
  return { queues: results, errors };
}

/** KP11-17, KP10-27: the lost-work recovery over every queue that has lost rows. */
export async function runQuotaRecovery(
  deps: Pick<AdmissionDeps, 'db' | 'clock' | 'logger'>,
  queues: readonly QuotaQueuePass[],
): Promise<QuotaRecoveryResult> {
  const results: RecoveryResult[] = [];
  const errors: CappedQueue[] = [];
  for (const pass of queues) {
    if (pass.recover === null) {
      continue;
    }
    try {
      results.push(await pass.recover(deps));
    } catch (error) {
      errors.push(pass.queue);
      deps.logger.error(
        { queue: QUOTA_RECOVERY_QUEUE, admittedQueue: pass.queue, error: (error as Error).name },
        'quota recovery of a queue failed',
      );
    }
  }
  return { queues: results, errors };
}

/** The two repeatable jobs (the recovery only when a queue has lost rows); none without a queue. */
export function quotaRepeatableJobs(
  deps: AdmissionDeps,
  queues: readonly QuotaQueuePass[],
): RepeatableJob[] {
  if (queues.length === 0) {
    return [];
  }
  const jobs: RepeatableJob[] = [
    {
      name: QUOTA_SWEEP_QUEUE,
      repeat: { every: QUOTA_SWEEP_INTERVAL_MS },
      run: () => runQuotaSweep(deps, queues),
    },
  ];
  if (queues.some((pass) => pass.recover !== null)) {
    jobs.push({
      name: QUOTA_RECOVERY_QUEUE,
      repeat: { every: QUOTA_RECOVERY_INTERVAL_MS },
      run: () => runQuotaRecovery(deps, queues),
    });
  }
  return jobs;
}
