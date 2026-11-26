/**
 * C135.3, C135.5, C138.1, C143.2 (Workflow 8B Stage 1b (F)): `case-export`, `case-attachment-scan`
 * and `case-rendition`. Postgres is the record (`case_exports`, `case_attachments`,
 * `file_renditions`), jobs carry ids alone, and a job is removed on completion and on failure. Each
 * job id is its row's (a rendition's is its source's), so a repeated request is one job. Frozen by
 * `foundation-8b`; the processors are `api-case-files`' (`jobs/cases/index.ts`).
 */
import { isId } from '@openverify/contracts';
import type {
  CaseAttachmentScanJob,
  CaseAttachmentScanQueue,
  CaseExportJob,
  CaseExportQueue,
  CaseRenditionJob,
  CaseRenditionQueue,
} from '../ports.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';
import { WORKFLOW_JOB_OPTIONS } from './workflow-queues.js';

export const CASE_EXPORT_QUEUE = 'case-export';
export const CASE_ATTACHMENT_SCAN_QUEUE = 'case-attachment-scan';
export const CASE_RENDITION_QUEUE = 'case-rendition';

export type ClosableCaseExportQueue = CaseExportQueue & { close(): Promise<void> };
export type ClosableCaseAttachmentScanQueue = CaseAttachmentScanQueue & {
  close(): Promise<void>;
};
export type ClosableCaseRenditionQueue = CaseRenditionQueue & { close(): Promise<void> };

/** One producer over BullMQ or an injected queue, opened on first use, whose job id is `jobIdOf`. */
function producer<Job extends { environmentId: string }>(
  name: string,
  options: { queue: JobQueue<Job> } | BullQueueOptions,
  isValid: (job: Job) => boolean,
  jobIdOf: (job: Job) => string,
): { enqueue: (job: Job) => Promise<void>; close: () => Promise<void> } {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    enqueue: async (job) => {
      if (!isId('env', job.environmentId) || !isValid(job)) {
        throw new TypeError(`${name} jobs carry an env_ id and their row's id`);
      }
      queue ??= createBullQueue<Job>(name, options as BullQueueOptions);
      await queue.add(name, job, { ...WORKFLOW_JOB_OPTIONS, jobId: jobIdOf(job) });
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}

/** The producer of `case-export`, over BullMQ or an injected queue, opened on first use. */
export function createCaseExportQueue(
  options: { queue: JobQueue<CaseExportJob> } | BullQueueOptions,
): ClosableCaseExportQueue {
  const queue = producer<CaseExportJob>(
    CASE_EXPORT_QUEUE,
    options,
    ({ caseExportId }) => isId('cexp', caseExportId),
    ({ caseExportId }) => caseExportId,
  );
  return {
    enqueueCaseExport: ({ environmentId, caseExportId }) =>
      queue.enqueue({ environmentId, caseExportId }),
    close: queue.close,
  };
}

/** The producer of `case-attachment-scan`, over BullMQ or an injected queue, opened on first use. */
export function createCaseAttachmentScanQueue(
  options: { queue: JobQueue<CaseAttachmentScanJob> } | BullQueueOptions,
): ClosableCaseAttachmentScanQueue {
  const queue = producer<CaseAttachmentScanJob>(
    CASE_ATTACHMENT_SCAN_QUEUE,
    options,
    ({ caseAttachmentId }) => isId('catt', caseAttachmentId),
    ({ caseAttachmentId }) => caseAttachmentId,
  );
  return {
    enqueueCaseAttachmentScan: ({ environmentId, caseAttachmentId }) =>
      queue.enqueue({ environmentId, caseAttachmentId }),
    close: queue.close,
  };
}

/** The producer of `case-rendition`, over BullMQ or an injected queue, opened on first use. */
export function createCaseRenditionQueue(
  options: { queue: JobQueue<CaseRenditionJob> } | BullQueueOptions,
): ClosableCaseRenditionQueue {
  const queue = producer<CaseRenditionJob>(
    CASE_RENDITION_QUEUE,
    options,
    ({ sourceId }) => isId('file', sourceId) || isId('catt', sourceId),
    ({ sourceId }) => sourceId,
  );
  return {
    enqueueCaseRendition: ({ environmentId, sourceId }) =>
      queue.enqueue({ environmentId, sourceId }),
    close: queue.close,
  };
}
