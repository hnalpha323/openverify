/**
 * C101.3, C107.1 (Workflow 7B): the `graph-index-sweep`, every 15 s: enqueues the pending
 * `graph_index_jobs` rows not enqueued in the last {@link GRAPH_INDEX_REENQUEUE_AFTER_MS}, and ends
 * `skipped` the row of an inquiry redacted after it was written (owner decision 5 after Workflow
 * 6C), which is never enqueued. Ids only in its logs. Owner: `api-graph`.
 */
import {
  endGraphIndexJob,
  listPendingGraphIndexJobs,
  markGraphIndexJobsEnqueued,
  type Db,
} from '@openverify/db';
import type { Clock, GraphIndexQueue } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';

/** A row enqueued this recently is left to its job (a lost enqueue is retried after it). */
export const GRAPH_INDEX_REENQUEUE_AFTER_MS = 60_000;
/** Rows per sweep. */
export const GRAPH_INDEX_SWEEP_BATCH = 500;

export interface GraphIndexSweepDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  index: GraphIndexQueue;
}

export type RunGraphIndexSweep = (deps: GraphIndexSweepDeps) => Promise<void>;

export const runGraphIndexSweep: RunGraphIndexSweep = async ({ db, clock, logger, index }) => {
  const now = clock.now();
  const pending = await listPendingGraphIndexJobs(db, {
    olderThan: new Date(now.getTime() - GRAPH_INDEX_REENQUEUE_AFTER_MS),
    limit: GRAPH_INDEX_SWEEP_BATCH,
  });
  const enqueued: { environmentId: string; inquiryId: string }[] = [];
  for (const { environmentId, inquiryId, inquiryRedacted } of pending) {
    if (inquiryRedacted) {
      await endGraphIndexJob(db, environmentId, inquiryId, {
        status: 'skipped',
        code: 'inquiry_redacted',
        at: now,
      });
      continue;
    }
    await index.enqueueGraphIndex({ environmentId, inquiryId });
    enqueued.push({ environmentId, inquiryId });
  }
  await markGraphIndexJobsEnqueued(db, enqueued, now);
  if (pending.length > 0) {
    logger.info(
      { enqueued: enqueued.length, skipped: pending.length - enqueued.length },
      'graph index sweep',
    );
  }
};
