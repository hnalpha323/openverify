/**
 * C102.3, C102.4 (Workflow 7B; F40): the `graph-query` job: one asynchronous run of a `submitted`
 * query. It claims its template under
 * `pg_try_advisory_xact_lock(hashtextextended('openverify/graph-query/' || env || template, 0))`
 * (one running query per template); a run that cannot claim returns successfully, and the
 * `graph-query-sweep` enqueues it again. The engine (`services/graph/query.ts`) searches hop by hop
 * in one read-only transaction under `SET LOCAL statement_timeout` within the deadline, and the run
 * stores the result, `completed` or `timed_out` with what it gathered, with its event. A query
 * cancelled meanwhile stays cancelled (the row lock decides, C102.8).
 *
 * The start comes from the node map the API bound (`setGraphQueryStart`), so the job needs no key;
 * a version that no longer parses ends the query `errored` (`graph_query_failed`), with its event.
 * Owner: `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signature.
 */
import type { GraphQueryStatus } from '@openverify/core';
import {
  getGraphQuery,
  getGraphQueryTemplateVersion,
  lockGraphQuery,
  openGraphQueryParamsOf,
  storeGraphQueryResult,
  type Db,
  type GraphQueryRow,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import type { Clock, GraphQueryJob } from '../../ports.js';
import { appendSystemAuditEntry } from '../../services/audit-log.js';
import { expansionStartOf } from '../../services/graph/expansion-start.js';
import { countsOf, filtersOf, kindsNotIndexedFor, resultOf } from '../../services/graph/queries.js';
import { searchGraph, startOf, templateClaim } from '../../services/graph/query.js';
import { configOf, queryResource, STATUS_EVENTS } from '../../services/graph/shared.js';
import type { WorkerLogger } from '../logger.js';

export interface GraphQueryDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  events: TransactionalEventPublisher;
  /** The base of `explorer-url`, which is `null` without one (owner decision 13 after 7B). */
  dashboardPublicUrl?: string | undefined;
}

export interface GraphQueryRunResult {
  /** The query's status after the run; `waiting` when another run held its template. */
  status: GraphQueryStatus | 'waiting';
}

export type ProcessGraphQuery = (
  job: GraphQueryJob,
  deps: GraphQueryDeps,
) => Promise<GraphQueryRunResult>;

type Stored = Parameters<typeof storeGraphQueryResult>[3];

/** Stores the run under the query's row lock, unless it was cancelled meanwhile (C102.8). */
async function store(
  deps: GraphQueryDeps,
  query: GraphQueryRow,
  result: Stored,
): Promise<GraphQueryRunResult> {
  const { environmentId, id } = query;
  const staged: StagedEvent[] = [];
  const status = await deps.db.transaction(async (tx) => {
    const locked = await lockGraphQuery(tx, environmentId, id);
    if (locked?.status !== 'submitted') {
      return locked?.status ?? 'cancelled';
    }
    const stored = await storeGraphQueryResult(tx, environmentId, id, result);
    if (stored === null) {
      return locked.status;
    }
    staged.push(
      await deps.events.stage(tx, {
        environmentId,
        name: STATUS_EVENTS[stored.status],
        payload: { data: queryResource(stored, 'event', deps.dashboardPublicUrl) },
      }),
    );
    // C102.7: every run is audited with its counts; no principal ran this one.
    await appendSystemAuditEntry(tx, environmentId, {
      action: STATUS_EVENTS[stored.status],
      resourceType: 'graph-query',
      resourceId: id,
      metadata: countsOf(stored),
    });
    return stored.status;
  });
  await deps.events.dispatch(staged);
  return { status };
}

/** A created-at window bound in the params (C102.2), opened only for its times. */
function windowOf(query: GraphQueryRow, config: ReturnType<typeof configOf>) {
  const params = openGraphQueryParamsOf(query) ?? {};
  const time = (placeholder: string | undefined) => {
    const value = placeholder === undefined ? undefined : params[placeholder.slice(2, -2)];
    return value === undefined ? null : new Date(value);
  };
  return {
    createdAtStart: time(config?.filters?.['created-at-start']),
    createdAtEnd: time(config?.filters?.['created-at-end']),
  };
}

export const processGraphQuery: ProcessGraphQuery = async (job, deps) => {
  const { db, clock, logger } = deps;
  const { environmentId, graphQueryId } = job;
  const query = await getGraphQuery(db, environmentId, graphQueryId);
  if (query === null) {
    return { status: 'cancelled' };
  }
  if (query.status !== 'submitted' || query.redactedAt !== null) {
    return { status: query.status };
  }
  const failed = (code: string): Stored => ({
    status: 'errored',
    nodes: [],
    links: [],
    nodeMap: query.nodeMap,
    accountIds: [],
    kindsNotIndexed: [],
    skippedHubValues: 0,
    nodeLimitReached: false,
    lastErrorCode: code,
    at: clock.now(),
  });
  const version = await getGraphQueryTemplateVersion(
    db,
    environmentId,
    query.graphQueryTemplateVersionId,
  );
  const config = version === null ? null : configOf(version);
  if (config === null) {
    logger.error({ environmentId, graphQueryId }, 'graph query template version unreadable');
    return store(deps, query, failed('graph_query_failed'));
  }
  const now = () => clock.now().getTime();
  // Owner decision 20 after 7B (Workflow 9B): an expansion (one start value no parameter bound)
  // runs one hop from its stored key, as its synchronous run does, and a key made under a retired
  // blind-index key lists its kind not indexed rather than answering no accounts.
  const expansion = expansionStartOf(query.nodeMap);
  try {
    const kinds = [
      ...new Set([
        ...(await kindsNotIndexedFor(db, environmentId, config)),
        ...(expansion?.retired === true ? [expansion.kind] : []),
      ]),
    ];
    const result = await searchGraph(
      db,
      {
        environmentId,
        config: expansion === null ? config : { ...config, 'max-hops': 2 },
        ...startOf(query.nodeMap),
        filters: filtersOf(config, windowOf(query, config)),
        deadline: now() + query.timeoutSeconds * 1000,
      },
      { now, claim: templateClaim(environmentId, query.graphQueryTemplateId) },
    );
    if (result === null) {
      return { status: 'waiting' };
    }
    const outcome = await store(deps, query, resultOf(result, kinds, clock.now()));
    logger.info(
      {
        environmentId,
        graphQueryId,
        status: outcome.status,
        accountCount: result.accountIds.length,
        nodeLimitReached: result.nodeLimitReached,
      },
      'graph query run',
    );
    return outcome;
  } catch (error) {
    logger.error(
      { environmentId, graphQueryId, error: error instanceof Error ? error.name : 'unknown' },
      'graph query failed',
    );
    return store(deps, query, failed('graph_query_failed'));
  }
};
