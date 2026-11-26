/**
 * C99.4, C99.7, C100.2, C107.1, C107.2 (Workflow 7B Stage 1b (L)): the `list-screen`, `list-import`
 * and `list-item-embed` queues and their producers, and the names and periods of their sweeps.
 *
 * - `list-screen`: one job per inquiry, its id the inquiry id. Processor `processListScreen`
 *   (`jobs/lists/screen.ts`, `api-lists`), with the keyring and the blind-index key.
 * - `list-import`: one job per importer, its id the importer id. Processor `processListImport`
 *   (`jobs/importers/process.ts`, `api-importers`).
 * - `list-item-embed`: one job per pending face or background item, its id the item id. Processor
 *   `processListItemEmbed` (`jobs/lists/embed.ts`, `api-biometric-lists`).
 * - `list-screen-sweep`, `list-import-sweep` and `list-item-embed-sweep`: every 15 s, each enqueues
 *   what is pending, so a lost enqueue recovers.
 *
 * Jobs are removed when they complete or fail (as C85.4's): the row is the record, and BullMQ
 * ignores an `add` under an id it still holds. Jobs carry ids only: no value, row or filename.
 * Frozen by `foundation-7b`; a change is a plan amendment.
 */
import { isId, type IdPrefix } from '@openverify/contracts';
import { LIST_KIND_REGISTRY } from '@openverify/core';
import type { JobsOptions } from 'bullmq';
import type {
  ListImportJob,
  ListImportQueue,
  ListItemEmbedJob,
  ListItemEmbedQueue,
  ListScreenJob,
  ListScreenQueue,
} from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';

export const LIST_SCREEN_QUEUE = 'list-screen';
export const LIST_SCREEN_JOB = 'list-screen';
export const LIST_IMPORT_QUEUE = 'list-import';
export const LIST_IMPORT_JOB = 'list-import';
export const LIST_ITEM_EMBED_QUEUE = 'list-item-embed';
export const LIST_ITEM_EMBED_JOB = 'list-item-embed';

/** C107.1: the sweeps' names (also their queues' and schedulers') and period. */
export const LIST_SCREEN_SWEEP_QUEUE = 'list-screen-sweep';
export const LIST_IMPORT_SWEEP_QUEUE = 'list-import-sweep';
export const LIST_ITEM_EMBED_SWEEP_QUEUE = 'list-item-embed-sweep';
export const LIST_SWEEP_INTERVAL_MS = 15_000;

/**
 * A run's database hiccups are retried with exponential backoff and jitter (about 5 s, 10 s, 20 s,
 * 40 s; provisional, as `report-run`'s); finished jobs are removed.
 */
export const LIST_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

/** The prefixes of the items that are ever embedded (C99.7). */
const EMBEDDED_PREFIXES = [
  LIST_KIND_REGISTRY.face.itemPrefix,
  LIST_KIND_REGISTRY['selfie-background'].itemPrefix,
] as IdPrefix[];

type Closable<Queue> = Queue & { close(): Promise<void> };

export type ClosableListScreenQueue = Closable<ListScreenQueue>;
export type ClosableListImportQueue = Closable<ListImportQueue>;
export type ClosableListItemEmbedQueue = Closable<ListItemEmbedQueue>;

/** The queue, injected or a lazy BullMQ one, so a process that never enqueues opens no connection. */
function lazyQueue<Job>(name: string, options: { queue: JobQueue<Job> } | BullQueueOptions) {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    open: () => (queue ??= createBullQueue<Job>(name, options as BullQueueOptions)),
    close: () => queue?.close() ?? Promise.resolve(),
  };
}

/** The producer of `list-screen`, over BullMQ or an injected queue. */
export function createListScreenQueue(
  options: { queue: JobQueue<ListScreenJob> } | BullQueueOptions,
): ClosableListScreenQueue {
  const queue = lazyQueue(LIST_SCREEN_QUEUE, options);
  return {
    async enqueueListScreen({ environmentId, inquiryId }) {
      if (!isId('env', environmentId) || !isId('inq', inquiryId)) {
        throw new TypeError('list-screen jobs need an env_ and an inq_ id');
      }
      await queue
        .open()
        .add(
          LIST_SCREEN_JOB,
          { environmentId, inquiryId },
          { ...LIST_JOB_OPTIONS, jobId: inquiryId },
        );
    },
    close: queue.close,
  };
}

/** The producer of `list-import`, over BullMQ or an injected queue. */
export function createListImportQueue(
  options: { queue: JobQueue<ListImportJob> } | BullQueueOptions,
): ClosableListImportQueue {
  const queue = lazyQueue(LIST_IMPORT_QUEUE, options);
  return {
    async enqueueListImport({ environmentId, importerId }) {
      if (!isId('env', environmentId) || !isId('mprt', importerId)) {
        throw new TypeError('list-import jobs need an env_ and an mprt_ id');
      }
      await queue
        .open()
        .add(
          LIST_IMPORT_JOB,
          { environmentId, importerId },
          { ...LIST_JOB_OPTIONS, jobId: importerId },
        );
    },
    close: queue.close,
  };
}

/** The producer of `list-item-embed`, over BullMQ or an injected queue. */
export function createListItemEmbedQueue(
  options: { queue: JobQueue<ListItemEmbedJob> } | BullQueueOptions,
): ClosableListItemEmbedQueue {
  const queue = lazyQueue(LIST_ITEM_EMBED_QUEUE, options);
  return {
    async enqueueListItemEmbed({ environmentId, itemId }) {
      if (
        !isId('env', environmentId) ||
        !EMBEDDED_PREFIXES.some((prefix) => isId(prefix, itemId))
      ) {
        throw new TypeError('list-item-embed jobs need an env_ and a lifc_ or lisb_ id');
      }
      await queue
        .open()
        .add(
          LIST_ITEM_EMBED_JOB,
          { environmentId, itemId },
          { ...LIST_JOB_OPTIONS, jobId: itemId },
        );
    },
    close: queue.close,
  };
}
