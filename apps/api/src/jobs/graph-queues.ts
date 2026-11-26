/**
 * C101.3, C101.5, C101.6, C102.4, C107.1, C107.2 (Workflow 7B Stage 1b (G)): the `graph-index` and
 * `graph-query` queues and their producers, and the names and periods of the graph's repeatable
 * jobs.
 *
 * - `graph-index`: one job per inquiry, its id the inquiry id. Processor `processGraphIndex`
 *   (`jobs/graph/index-job.ts`, `api-graph`), with the keyring and the blind-index key.
 * - `graph-query`: one job per asynchronous query run, its id the query id. Processor
 *   `processGraphQuery` (`jobs/graph/query.ts`, `api-graph`). A run is one attempt: a run that
 *   cannot claim its template returns, and the sweep enqueues it again (C102.4, F40); a run past its
 *   deadline is a `timed_out` result, never a retry.
 * - `graph-index-sweep` and `graph-query-sweep`: every 15 s, each enqueues what is pending, so a
 *   lost enqueue recovers.
 * - `graph-backfill` (C101.5): every minute; it runs one bounded, resumable batch while any
 *   `graph_index_state` row is incomplete (the upgrade's rows, or a switch's), and nothing once all
 *   are complete. So it runs at startup until complete, and picks up a switch within a minute.
 * - `graph-components` (C101.6): nightly at 03:00 UTC, for the environments with
 *   `graph-components` on.
 *
 * Jobs are removed when they complete or fail (as C85.4's): the row is the record, and BullMQ
 * ignores an `add` under an id it still holds. Jobs carry ids only: no value, key or parameter.
 * Frozen by `foundation-7b`; a change is a plan amendment.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type { GraphIndexJob, GraphIndexQueue, GraphQueryJob, GraphQueryQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export const GRAPH_INDEX_QUEUE = 'graph-index';
export const GRAPH_INDEX_JOB = 'graph-index';
export const GRAPH_QUERY_QUEUE = 'graph-query';
export const GRAPH_QUERY_JOB = 'graph-query';

/** C107.1: the repeatable jobs' names (also their queues' and schedulers') and periods. */
export const GRAPH_INDEX_SWEEP_QUEUE = 'graph-index-sweep';
export const GRAPH_QUERY_SWEEP_QUEUE = 'graph-query-sweep';
export const GRAPH_SWEEP_INTERVAL_MS = 15_000;
export const GRAPH_BACKFILL_QUEUE = 'graph-backfill';
export const GRAPH_BACKFILL_INTERVAL_MS = 60_000;
export const GRAPH_COMPONENTS_QUEUE = 'graph-components';
/** Nightly, in UTC (provisional; basis: outside business hours for most operators). */
export const GRAPH_COMPONENTS_PATTERN = '0 3 * * *';

/**
 * An index run's database hiccups are retried with exponential backoff and jitter (about 5 s,
 * 10 s, 20 s, 40 s; provisional, as `list-screen`'s); finished jobs are removed.
 */
export const GRAPH_INDEX_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

/** One attempt per run: the `graph-query-sweep` is the retry of a submitted query (C102.4). */
export const GRAPH_QUERY_JOB_OPTIONS = Object.freeze({
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

type Closable<Queue> = Queue & { close(): Promise<void> };

export type ClosableGraphIndexQueue = Closable<GraphIndexQueue>;
export type ClosableGraphQueryQueue = Closable<GraphQueryQueue>;

/** The queue, injected or a lazy BullMQ one, so a process that never enqueues opens no connection. */
function lazyQueue<Job>(name: string, options: { queue: JobQueue<Job> } | BullQueueOptions) {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    open: () => (queue ??= createBullQueue<Job>(name, options as BullQueueOptions)),
    close: () => queue?.close() ?? Promise.resolve(),
  };
}

/** The producer of `graph-index`, over BullMQ or an injected queue. */
export function createGraphIndexQueue(
  options: { queue: JobQueue<GraphIndexJob> } | BullQueueOptions,
): ClosableGraphIndexQueue {
  const queue = lazyQueue(GRAPH_INDEX_QUEUE, options);
  return {
    async enqueueGraphIndex({ environmentId, inquiryId }) {
      if (!isId('env', environmentId) || !isId('inq', inquiryId)) {
        throw new TypeError('graph-index jobs need an env_ and an inq_ id');
      }
      await queue
        .open()
        .add(
          GRAPH_INDEX_JOB,
          { environmentId, inquiryId },
          { ...GRAPH_INDEX_JOB_OPTIONS, jobId: inquiryId },
        );
    },
    close: queue.close,
  };
}

/** The producer of `graph-query`, over BullMQ or an injected queue. */
export function createGraphQueryQueue(
  options: { queue: JobQueue<GraphQueryJob> } | BullQueueOptions,
): ClosableGraphQueryQueue {
  const queue = lazyQueue(GRAPH_QUERY_QUEUE, options);
  return {
    async enqueueGraphQuery({ environmentId, graphQueryId }) {
      if (!isId('env', environmentId) || !isId('grphq', graphQueryId)) {
        throw new TypeError('graph-query jobs need an env_ and a grphq_ id');
      }
      await queue
        .open()
        .add(
          GRAPH_QUERY_JOB,
          { environmentId, graphQueryId },
          { ...GRAPH_QUERY_JOB_OPTIONS, jobId: graphQueryId },
        );
    },
    close: queue.close,
  };
}
