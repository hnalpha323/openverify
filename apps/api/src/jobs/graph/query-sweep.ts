/**
 * C102.4, C107.1 (Workflow 7B; F40): the `graph-query-sweep`, every 15 s: enqueues the `submitted`
 * asynchronous queries not enqueued in the last {@link GRAPH_QUERY_REENQUEUE_AFTER_MS}, among them
 * those whose run found the template claimed; a synchronous query is never the sweep's. Ids only in
 * its logs. Owner: `api-graph`.
 */
import { listSubmittedGraphQueries, markGraphQueriesEnqueued, type Db } from '@openverify/db';
import type { Clock, GraphQueryQueue } from '../../ports.js';
import type { WorkerLogger } from '../logger.js';

/** A query enqueued this recently is left to its job, or to the run holding its template. */
export const GRAPH_QUERY_REENQUEUE_AFTER_MS = 30_000;
/** Queries per sweep. */
export const GRAPH_QUERY_SWEEP_BATCH = 200;

export interface GraphQuerySweepDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  queries: GraphQueryQueue;
}

export type RunGraphQuerySweep = (deps: GraphQuerySweepDeps) => Promise<void>;

export const runGraphQuerySweep: RunGraphQuerySweep = async ({ db, clock, logger, queries }) => {
  const now = clock.now();
  const due = await listSubmittedGraphQueries(db, {
    olderThan: new Date(now.getTime() - GRAPH_QUERY_REENQUEUE_AFTER_MS),
    limit: GRAPH_QUERY_SWEEP_BATCH,
  });
  for (const query of due) {
    await queries.enqueueGraphQuery(query);
  }
  await markGraphQueriesEnqueued(db, due, now);
  if (due.length > 0) {
    logger.info({ enqueued: due.length }, 'graph query sweep');
  }
};
