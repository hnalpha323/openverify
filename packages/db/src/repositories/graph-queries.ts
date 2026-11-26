/**
 * C102.4 (Workflow 7B): `graph_queries` and their stored results. Owner: `api-graph`;
 * `foundation-7b` (Stage 1b (G)) froze the signatures. The redaction is `graph-redaction.ts`.
 *
 * `params` is sealed for the row (`SEALED.graphQueryParams`); the result holds account ids, random
 * node ids local to it and the node map to value keys, never a value (P17).
 */
import type { GraphQueryStatus } from '@openverify/core';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { graphQueries, type GraphQueryRow } from '../schema.js';
import { openJson, sealJson } from '../sealed.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { equalsAny, firstOrNull, inserted } from './rows.js';

export interface NewGraphQuery {
  id: string;
  graphQueryTemplateId: string;
  graphQueryTemplateVersionId: string;
  /** The bound `parameter-map`, sealed for the row on write. */
  params: Readonly<Record<string, string>>;
  timeoutSeconds: number;
  runSync: boolean;
}

/** What a run stored: ids, node ids and value keys only. */
export interface GraphQueryResult {
  status: 'completed' | 'timed_out' | 'errored';
  nodes: readonly unknown[];
  links: readonly unknown[];
  nodeMap: Readonly<Record<string, unknown>>;
  accountIds: readonly string[];
  kindsNotIndexed: readonly number[];
  skippedHubValues: number;
  nodeLimitReached: boolean;
  lastErrorCode?: string | undefined;
  at: Date;
}

export interface GraphQueryFilters {
  statuses?: readonly GraphQueryStatus[] | undefined;
  graphQueryTemplateIds?: readonly string[] | undefined;
}

const queryCursor = environmentCursor(graphQueries);

const isQuery = (environmentId: string, id: string) =>
  and(eq(graphQueries.environmentId, environmentId), eq(graphQueries.id, id));

const EMPTY_RESULT = {
  nodes: [],
  links: [],
  nodeMap: {},
  accountIds: [],
  kindsNotIndexed: [],
  skippedHubValues: 0,
  nodeLimitReached: false,
};

export async function createGraphQuery(
  tx: Db,
  environmentId: string,
  input: NewGraphQuery,
): Promise<GraphQueryRow> {
  return inserted(
    await tx
      .insert(graphQueries)
      .values({
        id: input.id,
        environmentId,
        graphQueryTemplateId: input.graphQueryTemplateId,
        graphQueryTemplateVersionId: input.graphQueryTemplateVersionId,
        paramsSealed: sealJson(SEALED.graphQueryParams, input.id, input.params),
        timeoutSeconds: input.timeoutSeconds,
        runSync: input.runSync,
      })
      .returning(),
    'createGraphQuery',
  );
}

export async function getGraphQuery(
  db: Db,
  environmentId: string,
  id: string,
): Promise<GraphQueryRow | null> {
  return firstOrNull(await db.select().from(graphQueries).where(isQuery(environmentId, id)));
}

/** The query's row, locked: a cancel and a completion race on it (one wins, C102.8). */
export async function lockGraphQuery(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<GraphQueryRow | null> {
  return firstOrNull(
    await tx.select().from(graphQueries).where(isQuery(environmentId, id)).for('update'),
  );
}

/** `created_at DESC, id DESC` (C1). */
export async function listGraphQueries(
  db: Db,
  environmentId: string,
  filters: GraphQueryFilters,
  page: PageRequest,
): Promise<Page<GraphQueryRow>> {
  const status = equalsAny(graphQueries.status, filters.statuses);
  const template = equalsAny(graphQueries.graphQueryTemplateId, filters.graphQueryTemplateIds);
  if (status === null || template === null) {
    return { items: [], next: null };
  }
  return paginate(db, queryCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(graphQueries)
      .where(and(eq(graphQueries.environmentId, environmentId), status, template, after))
      .orderBy(...newestFirst(queryCursor))
      .limit(limit),
  );
}

/** The bound params, opened; `null` once redacted. */
export function openGraphQueryParamsOf(
  row: GraphQueryRow,
): Readonly<Record<string, string>> | null {
  return row.paramsSealed === null
    ? null
    : (openJson(SEALED.graphQueryParams, row.id, row.paramsSealed) as Record<string, string>);
}

/** Stores a run's result on a `submitted` query; `null` when it is no longer `submitted`. */
export async function storeGraphQueryResult(
  tx: Db,
  environmentId: string,
  id: string,
  result: GraphQueryResult,
): Promise<GraphQueryRow | null> {
  return firstOrNull(
    await tx
      .update(graphQueries)
      .set({
        status: result.status,
        nodes: [...result.nodes],
        links: [...result.links],
        nodeMap: { ...result.nodeMap },
        accountIds: [...result.accountIds],
        kindsNotIndexed: [...result.kindsNotIndexed],
        skippedHubValues: result.skippedHubValues,
        nodeLimitReached: result.nodeLimitReached,
        lastErrorCode: result.lastErrorCode ?? null,
        completedAt: result.status === 'completed' ? result.at : null,
        erroredAt: result.status === 'errored' ? result.at : null,
        attempts: sql`${graphQueries.attempts} + 1`,
      })
      .where(
        and(
          isQuery(environmentId, id),
          eq(graphQueries.status, 'submitted'),
          isNull(graphQueries.redactedAt),
        ),
      )
      .returning(),
  );
}

/** `POST /:id/cancel` on a `submitted` query; `null` when it is no longer `submitted`. */
export async function cancelGraphQuery(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<GraphQueryRow | null> {
  return firstOrNull(
    await tx
      .update(graphQueries)
      .set({ status: 'cancelled', updatedAt: at })
      .where(and(isQuery(environmentId, id), eq(graphQueries.status, 'submitted')))
      .returning(),
  );
}

/** `POST /:id/rerun`: back to `submitted`, its result emptied; `null` once redacted. */
export async function resubmitGraphQuery(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<GraphQueryRow | null> {
  return firstOrNull(
    await tx
      .update(graphQueries)
      .set({
        status: 'submitted',
        ...EMPTY_RESULT,
        lastErrorCode: null,
        completedAt: null,
        erroredAt: null,
        enqueuedAt: null,
        updatedAt: at,
      })
      .where(and(isQuery(environmentId, id), isNull(graphQueries.redactedAt)))
      .returning(),
  );
}

/** The `graph-query-sweep`'s read: submitted queries not enqueued since `olderThan`, oldest first. */
export async function listSubmittedGraphQueries(
  db: Db,
  options: { olderThan: Date; limit: number },
): Promise<{ environmentId: string; graphQueryId: string }[]> {
  const rows = await db
    .select({ environmentId: graphQueries.environmentId, graphQueryId: graphQueries.id })
    .from(graphQueries)
    .where(
      and(
        eq(graphQueries.status, 'submitted'),
        eq(graphQueries.runSync, false),
        or(isNull(graphQueries.enqueuedAt), lt(graphQueries.enqueuedAt, options.olderThan)),
      ),
    )
    .orderBy(asc(graphQueries.createdAt), asc(graphQueries.id))
    .limit(options.limit);
  return rows;
}

export async function markGraphQueriesEnqueued(
  db: Db,
  queries: readonly { environmentId: string; graphQueryId: string }[],
  at: Date,
): Promise<void> {
  for (const query of queries) {
    await db
      .update(graphQueries)
      .set({ enqueuedAt: at })
      .where(
        and(isQuery(query.environmentId, query.graphQueryId), eq(graphQueries.status, 'submitted')),
      );
  }
}

interface StoredNode {
  type: string;
  value: string;
}

interface StoredLink {
  from: string;
  to: string;
  kind: string;
}

/**
 * C101.4, C102.7: removes an account, its node and its links from every stored result of the
 * environment, and a property node no account of the result links to any more, rewriting each
 * result's node map; answers the queries changed.
 */
export async function scrubAccountFromGraphQueries(
  tx: Db,
  environmentId: string,
  accountId: string,
): Promise<string[]> {
  const rows = await tx
    .select()
    .from(graphQueries)
    .where(
      and(
        eq(graphQueries.environmentId, environmentId),
        sql`${graphQueries.accountIds} @> array[${accountId}]::text[]`,
      ),
    )
    .orderBy(asc(graphQueries.id))
    .for('update');
  for (const row of rows) {
    const links = (row.links as StoredLink[]).filter(
      (link) => link.from !== accountId && link.to !== accountId,
    );
    const linked = new Set(links.flatMap((link) => [link.from, link.to]));
    const nodes = (row.nodes as StoredNode[]).filter((node) =>
      node.type === 'account'
        ? node.value !== accountId
        : linked.has(node.value) || isStart(row, node.value),
    );
    const kept = new Set(nodes.map((node) => node.value));
    const nodeMap = Object.fromEntries(
      Object.entries(row.nodeMap).filter(([nodeId]) => kept.has(nodeId)),
    );
    await tx
      .update(graphQueries)
      .set({
        nodes,
        links,
        nodeMap,
        accountIds: row.accountIds.filter((id) => id !== accountId),
      })
      .where(isQuery(environmentId, row.id));
  }
  return rows.map((row) => row.id);
}

/** A start node stays in its result even when no account is left linked to it. */
function isStart(row: GraphQueryRow, nodeId: string): boolean {
  const entry = row.nodeMap[nodeId] as { start?: unknown } | undefined;
  return entry?.start === true;
}

/**
 * C102.4: the start the API bound (the start nodes' keys, or accounts), written to the node map of
 * a `submitted` query before its run, so the `graph-query` job needs no key.
 */
export async function setGraphQueryStart(
  tx: Db,
  environmentId: string,
  id: string,
  nodeMap: Readonly<Record<string, unknown>>,
): Promise<GraphQueryRow | null> {
  return firstOrNull(
    await tx
      .update(graphQueries)
      .set({ nodeMap: { ...nodeMap } })
      .where(and(isQuery(environmentId, id), eq(graphQueries.status, 'submitted')))
      .returning(),
  );
}
