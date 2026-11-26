/**
 * C127.12, C143.1, C143.2 (Workflow 8A Stage 1b (A); V03): `list-rescreen`. Postgres is the only
 * record (`list_rescreen_requests`), jobs carry ids alone, and `list-rescreen-sweep` stands behind
 * the queue, so a lost Valkey delays a re-screen and never loses it. Frozen by `foundation-8a`.
 */
import { isId } from '@openverify/contracts';
import type { ListRescreenJob, ListRescreenQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';
import { WORKFLOW_JOB_OPTIONS } from './workflow-queues.js';

export const LIST_RESCREEN_QUEUE = 'list-rescreen';
export const LIST_RESCREEN_SWEEP_QUEUE = 'list-rescreen-sweep';
export const LIST_RESCREEN_INTERVAL_MS = 15_000;

export type ClosableListRescreenQueue = ListRescreenQueue & { close(): Promise<void> };

/** The producer of `list-rescreen`, over BullMQ or an injected queue, opened on first use. */
export function createListRescreenQueue(
  options: { queue: JobQueue<ListRescreenJob> } | BullQueueOptions,
): ClosableListRescreenQueue {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    async enqueueListRescreen({ environmentId, listId, listVersion }) {
      if (
        !isId('env', environmentId) ||
        !isId('lst', listId) ||
        !Number.isInteger(listVersion) ||
        listVersion < 1
      ) {
        throw new TypeError('list-rescreen jobs need an env_ and a lst_ id and a version');
      }
      queue ??= createBullQueue<ListRescreenJob>(LIST_RESCREEN_QUEUE, options as BullQueueOptions);
      await queue.add(
        LIST_RESCREEN_QUEUE,
        { environmentId, listId, listVersion },
        { ...WORKFLOW_JOB_OPTIONS, jobId: `${listId}-${String(listVersion)}` },
      );
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}
