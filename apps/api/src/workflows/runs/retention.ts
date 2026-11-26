/**
 * C120.8, C118.1, C119.3: the engine's steps of the C16 pass. A run's values go past
 * `workflow-run-retention-days`, its skeleton and delivery rows past
 * `workflow-run-history-retention-days` (under `openverify.retention`, the journal's escape). Trigger
 * files whose key has gone are deleted from storage, and a failed delete waits for the next pass.
 * Processed wait candidates go once they are older than the longest wait. Unfinished runs are never
 * removed: the 90-day run deadline bounds them.
 */
import {
  deleteExpiredWorkflowRunSkeletons,
  deleteProcessedWaitCandidates,
  expireWorkflowDeliveries,
  listRedactedWorkflowRunFiles,
  markWorkflowRunFilesDeleted,
  purgeExpiredWorkflowRunValues,
  type Db,
  type DeleteOptions,
} from '@openverify/db';
import { WORKFLOW_RUN_LIMITS } from '@openverify/workflow-engine';
import type { FileStorage } from '../../ports.js';

export interface WorkflowRetentionReport {
  purgedWorkflowRunValues: number;
  deletedWorkflowRunSkeletons: number;
  expiredWorkflowDeliveries: number;
  purgedWorkflowRunFiles: number;
}

export interface WorkflowRetentionDeps {
  db: Db;
  storage: FileStorage;
}

const WAIT_MS = WORKFLOW_RUN_LIMITS['wait-seconds'].value * 1_000;

/** Calls a batch step until it finds nothing. */
async function drain(step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let count = await step(); count > 0; count = await step()) {
    total += count;
  }
  return total;
}

/** One batch of file objects; a delete that fails leaves its row for the next pass. */
async function deleteFiles(deps: WorkflowRetentionDeps, options: Required<DeleteOptions>) {
  const files = await listRedactedWorkflowRunFiles(deps.db, { limit: options.limit });
  const gone: string[] = [];
  for (const file of files) {
    try {
      await deps.storage.delete(file.storageKey);
      gone.push(file.id);
    } catch {
      // C105.5: left to the next pass; it fails nothing.
    }
  }
  await markWorkflowRunFilesDeleted(deps.db, gone, options.now);
  return gone.length;
}

export async function runWorkflowRetention(
  deps: WorkflowRetentionDeps,
  options: Required<DeleteOptions>,
): Promise<WorkflowRetentionReport> {
  const { db } = deps;
  const purgedWorkflowRunValues = await drain(() => purgeExpiredWorkflowRunValues(db, options));
  const deletedWorkflowRunSkeletons = await drain(() =>
    deleteExpiredWorkflowRunSkeletons(db, options),
  );
  const expiredWorkflowDeliveries = await drain(() => expireWorkflowDeliveries(db, options));
  const purgedWorkflowRunFiles = await drain(() => deleteFiles(deps, options));
  await drain(() =>
    deleteProcessedWaitCandidates(db, {
      before: new Date(options.now.getTime() - WAIT_MS),
      limit: options.limit,
    }),
  );
  return {
    purgedWorkflowRunValues,
    deletedWorkflowRunSkeletons,
    expiredWorkflowDeliveries,
    purgedWorkflowRunFiles,
  };
}
