/**
 * C137.4, C143.2 (Workflow 8B Stage 1b (C)): `case-bulk`. Postgres is the record (`case_bulk_actions`),
 * jobs carry ids alone, and a job is removed on completion and on failure. Frozen by `foundation-8b`;
 * the processor is `api-cases`' (`services/cases/bulk/process.ts`).
 */
import { isId } from '@openverify/contracts';
import type { CaseBulkJob, CaseBulkQueue } from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';
import { WORKFLOW_JOB_OPTIONS } from './workflow-queues.js';

export const CASE_BULK_QUEUE = 'case-bulk';

export type ClosableCaseBulkQueue = CaseBulkQueue & { close(): Promise<void> };

/** The producer of `case-bulk`, over BullMQ or an injected queue, opened on first use. */
export function createCaseBulkQueue(
  options: { queue: JobQueue<CaseBulkJob> } | BullQueueOptions,
): ClosableCaseBulkQueue {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    async enqueueCaseBulkAction({ environmentId, bulkActionId }) {
      if (!isId('env', environmentId) || !isId('cblk', bulkActionId)) {
        throw new TypeError('case-bulk jobs need an env_ and a cblk_ id');
      }
      queue ??= createBullQueue<CaseBulkJob>(CASE_BULK_QUEUE, options as BullQueueOptions);
      await queue.add(
        CASE_BULK_QUEUE,
        { environmentId, bulkActionId },
        { ...WORKFLOW_JOB_OPTIONS, jobId: bulkActionId },
      );
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}
