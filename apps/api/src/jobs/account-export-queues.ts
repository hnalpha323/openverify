/**
 * C253.2 (Workflow 11B Stage 1b (D)): the `account-export` queue, one job per access export, its id
 * the export's (`aexp_`), carrying ids only (never a value, rule 11). The job cuts the export's
 * manifest (`processAccountExport`, `jobs/account-export/process.ts`, `dsar-export`'s). The queue is
 * under C251's cap (Stage 1a amendment 16): a create leaves the export `pending` and unadmitted, and
 * `quotas`' admission enqueues it and stamps `account_exports.admitted_at`.
 *
 * One attempt, removed when it ends, as Phase 9's `export` (`WORKFLOW_JOB_OPTIONS`): a failed cut
 * marks the export `failed` with its code, and the caller asks again.
 *
 * Frozen by `foundation-11b`; a change is a plan amendment.
 */
import { isId } from '@openverify/contracts';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';
import { WORKFLOW_JOB_OPTIONS } from './workflow-queues.js';

export const ACCOUNT_EXPORT_QUEUE = 'account-export';
export const ACCOUNT_EXPORT_JOB = 'account-export';

/** C253.2: an export's job: its environment and the export, ids only. */
export interface AccountExportJob {
  environmentId: string;
  exportId: string;
}

/** The `account-export` producer. */
export interface AccountExportQueue {
  enqueueAccountExport(job: AccountExportJob): Promise<void>;
}

export type ClosableAccountExportQueue = AccountExportQueue & { close(): Promise<void> };

export type AccountExportQueueOptions = { queue: JobQueue<AccountExportJob> } | BullQueueOptions;

/** The producer of `account-export`, over BullMQ or an injected queue; opened on first use. */
export function createAccountExportQueue(
  options: AccountExportQueueOptions,
): ClosableAccountExportQueue {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    async enqueueAccountExport({ environmentId, exportId }) {
      if (!isId('env', environmentId) || !isId('aexp', exportId)) {
        throw new TypeError('account-export jobs need an env_ and an aexp_ id');
      }
      queue ??= createBullQueue<AccountExportJob>(
        ACCOUNT_EXPORT_QUEUE,
        options as BullQueueOptions,
      );
      await queue.add(
        ACCOUNT_EXPORT_JOB,
        { environmentId, exportId },
        { ...WORKFLOW_JOB_OPTIONS, jobId: exportId },
      );
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}
