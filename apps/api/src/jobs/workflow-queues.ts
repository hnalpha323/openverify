/**
 * C117.8, C117.9, C118.1, C119.3, C143.1, C143.2 (Workflow 8A Stage 1b (E)): the engine's queues and
 * their producers, and the names and periods of its repeatable jobs.
 *
 * - `workflow-step` for interactive triggers and `workflow-step-batch` for schedules, recurring ticks
 *   and fan-outs (C117.8): each job one claim attempt, its id `<step id>-<attempt>` (C117.9);
 * - `workflow-trigger`: one job per delivery, its id the delivery id (C118.1);
 * - `workflow-wait-match`: one job per candidate, its id the event id (C119.3).
 *
 * Postgres is the only record. Jobs carry ids alone, and a sweep stands behind each queue, so a lost
 * Valkey delays work and never loses it (C117.9). Frozen by `foundation-8a`; a change is a plan
 * amendment.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type {
  WorkflowStepJob,
  WorkflowStepQueue,
  WorkflowTriggerJob,
  WorkflowTriggerQueue,
  WorkflowWaitMatchJob,
  WorkflowWaitMatchQueue,
} from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export const WORKFLOW_STEP_QUEUE = 'workflow-step';
export const WORKFLOW_STEP_BATCH_QUEUE = 'workflow-step-batch';
export const WORKFLOW_TRIGGER_QUEUE = 'workflow-trigger';
export const WORKFLOW_WAIT_MATCH_QUEUE = 'workflow-wait-match';

/** C143.1: the repeatable jobs' names (also their queues' and schedulers') and periods. */
export const WORKFLOW_STEP_SWEEP_QUEUE = 'workflow-step-sweep';
export const WORKFLOW_TRIGGER_SWEEP_QUEUE = 'workflow-trigger-sweep';
export const WORKFLOW_WAIT_MATCH_SWEEP_QUEUE = 'workflow-wait-match-sweep';
export const WORKFLOW_SCHEDULE_SWEEP_QUEUE = 'workflow-schedule-sweep';
export const WORKFLOW_SCHEDULED_RUNS_QUEUE = 'workflow-scheduled-runs';
export const WORKFLOW_SWEEP_INTERVAL_MS = 15_000;
export const PUBLISHER_RIGHTS_QUEUE = 'publisher-rights';
export const PUBLISHER_RIGHTS_INTERVAL_MS = 60_000;

/**
 * C117.6: the engine owns business retries (a `due_at` row), so BullMQ's attempt covers infrastructure
 * alone and a job that fails goes: the sweeps find its row. Removed when it finishes, because BullMQ
 * ignores an `add` under an id it still holds (the left-over-id trap, `webhooks/queue.ts`).
 */
export const WORKFLOW_JOB_OPTIONS = Object.freeze({
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

type Closable<Queue> = Queue & { close(): Promise<void> };

export type ClosableWorkflowStepQueue = Closable<WorkflowStepQueue>;
export type ClosableWorkflowTriggerQueue = Closable<WorkflowTriggerQueue>;
export type ClosableWorkflowWaitMatchQueue = Closable<WorkflowWaitMatchQueue>;

/** The queue, injected or a lazy BullMQ one, so a process that never enqueues opens no connection. */
function lazyQueue<Job>(name: string, options: { queue: JobQueue<Job> } | BullQueueOptions) {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    open: () => (queue ??= createBullQueue<Job>(name, options as BullQueueOptions)),
    close: () => queue?.close() ?? Promise.resolve(),
  };
}

/** The producers of `workflow-step` and `workflow-step-batch` (C117.8), one queue chosen per job. */
export function createWorkflowStepQueue(
  options: { step: JobQueue<WorkflowStepJob>; batch: JobQueue<WorkflowStepJob> } | BullQueueOptions,
): ClosableWorkflowStepQueue {
  const step = lazyQueue<WorkflowStepJob>(
    WORKFLOW_STEP_QUEUE,
    'step' in options ? { queue: options.step } : options,
  );
  const batch = lazyQueue<WorkflowStepJob>(
    WORKFLOW_STEP_BATCH_QUEUE,
    'batch' in options ? { queue: options.batch } : options,
  );
  return {
    async enqueueWorkflowStep({ environmentId, runId, stepId, attempt }, enqueue = {}) {
      if (
        !isId('env', environmentId) ||
        !isId('wfr', runId) ||
        !isId('wfst', stepId) ||
        !Number.isInteger(attempt)
      ) {
        throw new TypeError('workflow-step jobs need env_, wfr_ and wfst_ ids and an attempt');
      }
      await (enqueue.batch === true ? batch : step).open().add(
        WORKFLOW_STEP_QUEUE,
        { environmentId, runId, stepId, attempt },
        {
          ...WORKFLOW_JOB_OPTIONS,
          jobId: `${stepId}-${String(attempt)}`,
          ...(enqueue.delayMs === undefined ? {} : { delay: enqueue.delayMs }),
        },
      );
    },
    async close() {
      await Promise.all([step.close(), batch.close()]);
    },
  };
}

/** The producer of `workflow-trigger` (C118.1), over BullMQ or an injected queue. */
export function createWorkflowTriggerQueue(
  options: { queue: JobQueue<WorkflowTriggerJob> } | BullQueueOptions,
): ClosableWorkflowTriggerQueue {
  const queue = lazyQueue(WORKFLOW_TRIGGER_QUEUE, options);
  return {
    async enqueueWorkflowTrigger({ environmentId, deliveryId }) {
      if (!isId('env', environmentId) || !isId('wftd', deliveryId)) {
        throw new TypeError('workflow-trigger jobs need an env_ and a wftd_ id');
      }
      await queue
        .open()
        .add(
          WORKFLOW_TRIGGER_QUEUE,
          { environmentId, deliveryId },
          { ...WORKFLOW_JOB_OPTIONS, jobId: deliveryId },
        );
    },
    close: queue.close,
  };
}

/** The producer of `workflow-wait-match` (C119.3), over BullMQ or an injected queue. */
export function createWorkflowWaitMatchQueue(
  options: { queue: JobQueue<WorkflowWaitMatchJob> } | BullQueueOptions,
): ClosableWorkflowWaitMatchQueue {
  const queue = lazyQueue(WORKFLOW_WAIT_MATCH_QUEUE, options);
  return {
    async enqueueWorkflowWaitMatch({ environmentId, eventId }) {
      if (!isId('env', environmentId) || !isId('evt', eventId)) {
        throw new TypeError('workflow-wait-match jobs need an env_ and an evt_ id');
      }
      await queue
        .open()
        .add(
          WORKFLOW_WAIT_MATCH_QUEUE,
          { environmentId, eventId },
          { ...WORKFLOW_JOB_OPTIONS, jobId: eventId },
        );
    },
    close: queue.close,
  };
}
