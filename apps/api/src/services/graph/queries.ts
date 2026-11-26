/**
 * C102.4 (Workflow 7B): the graph query routes' service. Owner: `api-graph`.
 *
 * - `POST /graph-queries` (`graph:write`): the template's published version, the parameters bound
 *   (`bind.ts`: P11's `pii:view` for a person-identifying one), the C12 policy `graph-queries`.
 *   An asynchronous run answers `submitted` and is enqueued after the commit (`deps.graphQueries`;
 *   the `graph-query-sweep` recovers a lost enqueue). `meta.run-sync` runs at once within 10 s on
 *   one of the environment's two synchronous slots (429 `graph_sync_limited` beyond) and answers
 *   the result, or what was gathered, `timed_out`.
 * - Every answer masks `params` member-wise without `pii:view`; every event carries no parameter,
 *   node or link (C107.5). A run is audited with its template version and, when it ends here, its
 *   counts and truncation, never its parameters (C102.7).
 * - `POST /:id/rerun` runs the pinned version again, as it ran (`graph-query.reran`, then the
 *   terminal event); `POST /:id/cancel` applies to `submitted` queries only (409
 *   `graph_query_not_cancellable`); a redacted query answers 410 `graph_query_redacted`.
 */
import {
  filterValues,
  type CreateGraphQueryBody,
  type GraphQueryDocument,
  type GraphQueryTemplateConfig,
  type graphQueryListDocumentSchema,
  type listGraphQueriesQuerySchema,
} from '@openverify/contracts';
import {
  GRAPH_KIND_REGISTRY,
  GRAPH_LIMITS,
  graphKindCode,
  graphQueryStatusSchema,
  type GraphKind,
} from '@openverify/core';
import {
  cancelGraphQuery as cancelQueryRow,
  createGraphQuery as insertQuery,
  getEnvironment,
  listCurrentGraphQueryTemplateVersions,
  listGraphIndexStates,
  listGraphQueries as listQueryRows,
  lockGraphQuery,
  openGraphQueryParamsOf,
  resubmitGraphQuery,
  setGraphQueryStart,
  storeGraphQueryResult,
  type Db,
  type GraphQueryRow,
} from '@openverify/db';
import { idSchema } from '@openverify/contracts';
import type { z } from 'zod';
import { ConflictError, GraphProblemError, NotFoundError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { GraphActing } from './acting.js';
import { canViewPii } from '../../auth/pii.js';
import { bindGraphQuery, type BoundGraphQuery } from './bind.js';
import { expansionStartOf } from './expansion-start.js';
import {
  searchGraph,
  startOf,
  synchronousClaim,
  type GraphNodeMapEntry,
  type GraphSearchResult,
} from './query.js';
import { graphSettingsOf, kindsNotIndexed } from './settings.js';
import {
  change,
  configOf,
  consumeGraphQueryRate,
  GRAPH_QUERIES_PATH,
  queryResource,
  requireGraphQuery,
  requireGraphQueryTemplate,
  requireGraphQueryTemplateVersion,
  STATUS_EVENTS,
  type GraphChange,
} from './shared.js';

export type ListGraphQueriesQuery = z.infer<typeof listGraphQueriesQuerySchema>;

/** The kinds a run may traverse or start from. */
function searchedKinds(config: GraphQueryTemplateConfig): GraphKind[] {
  const weak = config['include-weak-kinds'] === true;
  const kinds = config['connect-kinds'].filter(
    (kind) => weak || GRAPH_KIND_REGISTRY[kind].strength !== 'weak',
  );
  for (const clause of config.start) {
    if (clause.kind !== 'account_id' && !kinds.includes(clause.kind)) {
      kinds.push(clause.kind);
    }
  }
  return kinds;
}

/** H10: the codes of the kinds the index lacks for this run. */
export async function kindsNotIndexedFor(
  db: Db,
  environmentId: string,
  config: GraphQueryTemplateConfig,
): Promise<number[]> {
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    return [];
  }
  return kindsNotIndexed(
    graphSettingsOf(environment),
    await listGraphIndexStates(db, environmentId),
    searchedKinds(config),
  ).map(graphKindCode);
}

/** A stored run's result row (`storeGraphQueryResult`). */
export function resultOf(
  result: GraphSearchResult,
  kinds: readonly number[],
  at: Date,
): Parameters<typeof storeGraphQueryResult>[3] {
  return {
    status: result.timedOut ? 'timed_out' : 'completed',
    nodes: result.nodes,
    links: result.links,
    nodeMap: result.nodeMap,
    accountIds: result.accountIds,
    kindsNotIndexed: kinds,
    skippedHubValues: result.skippedHubValues,
    nodeLimitReached: result.nodeLimitReached,
    at,
  };
}

/** What a run's audit entry says: counts and truncation, never a parameter (C102.7). */
export const countsOf = (query: GraphQueryRow) => ({
  status: query.status,
  'node-count': query.nodes.length,
  'account-count': query.accountIds.length,
  'node-limit-reached': query.nodeLimitReached,
  'skipped-hub-values': query.skippedHubValues,
});

async function publishedConfig(
  deps: ApiDependencies,
  environmentId: string,
  templateId: string,
): Promise<{ versionId: string; config: GraphQueryTemplateConfig }> {
  const template = await requireGraphQueryTemplate(deps.db, environmentId, templateId);
  if (template.status === 'archived') {
    throw new GraphProblemError(
      'graph_template_archived',
      `Graph query template ${templateId} is archived.`,
    );
  }
  const published = (
    await listCurrentGraphQueryTemplateVersions(deps.db, environmentId, [templateId])
  ).get(templateId)?.published;
  const config = published === undefined || published === null ? null : configOf(published);
  if (published === undefined || published === null || config === null) {
    throw new GraphProblemError(
      'graph_template_not_published',
      `Graph query template ${templateId} has no published version.`,
    );
  }
  return { versionId: published.id, config };
}

/** C102.4 (P25): the synchronous run, on one of the environment's two slots. */
async function runSynchronously(
  deps: ApiDependencies,
  environmentId: string,
  config: GraphQueryTemplateConfig,
  bound: BoundGraphQuery,
  timeoutSeconds: number,
): Promise<GraphSearchResult> {
  const now = () => deps.clock.now().getTime();
  const result = await searchGraph(
    deps.db,
    {
      environmentId,
      config,
      startAccounts: bound.startAccounts,
      startValues: bound.startValues,
      filters: filtersOf(config, bound),
      deadline: now() + timeoutSeconds * 1000,
    },
    { now, claim: synchronousClaim(environmentId) },
  );
  if (result === null) {
    throw new GraphProblemError(
      'graph_sync_limited',
      'This environment is running its synchronous graph queries; retry later or run asynchronously.',
      { headers: { 'retry-after': '1' } },
    );
  }
  return result;
}

/** C102.2: the account filters of a template, with the bound created-at window. */
export function filtersOf(
  config: GraphQueryTemplateConfig,
  window: { createdAtStart: Date | null; createdAtEnd: Date | null },
) {
  return {
    accountTypeIds: config.filters?.['account-type-ids'],
    statuses: config.filters?.['account-statuses'],
    tags: config.filters?.tags,
    createdAtStart: window.createdAtStart,
    createdAtEnd: window.createdAtEnd,
  };
}

/** Stores a synchronous run's result and stages its terminal event and audit. */
async function storeSynchronous(
  deps: ApiDependencies,
  unit: GraphChange,
  environmentId: string,
  id: string,
  result: GraphSearchResult,
  kinds: readonly number[],
  at: Date,
): Promise<GraphQueryRow> {
  const stored = await storeGraphQueryResult(
    unit.tx,
    environmentId,
    id,
    resultOf(result, kinds, at),
  );
  if (stored === null) {
    throw new ConflictError(`Graph query ${id} is no longer submitted.`);
  }
  await unit.emit(STATUS_EVENTS[stored.status], { data: queryResource(stored, 'event', deps.dashboardPublicUrl) });
  await unit.audit({
    action: STATUS_EVENTS[stored.status],
    resourceType: 'graph-query',
    resourceId: id,
    metadata: countsOf(stored),
  });
  return stored;
}

async function enqueue(deps: ApiDependencies, environmentId: string, graphQueryId: string) {
  try {
    await deps.graphQueries?.enqueueGraphQuery({ environmentId, graphQueryId });
  } catch {
    // The graph-query-sweep enqueues a submitted query within 15 s.
  }
}

export async function createGraphQuery(
  deps: ApiDependencies,
  acting: GraphActing,
  body: CreateGraphQueryBody,
): Promise<GraphQueryDocument> {
  const { environmentId } = acting.ctx;
  const attributes = body.data.attributes;
  const params = attributes['parameter-map'] ?? attributes['variable-map'] ?? {};
  const runSync = body.meta?.['run-sync'] === true;
  const templateId = attributes['graph-query-template-id'];
  const { versionId, config } = await publishedConfig(deps, environmentId, templateId);
  const bound = bindGraphQuery(
    deps.blindIndexKey,
    environmentId,
    canViewPii(acting.principal),
    config,
    params,
  );
  await consumeGraphQueryRate(deps, environmentId);
  const requested = attributes['timeout-in-seconds'] ?? GRAPH_LIMITS.defaultTimeoutSeconds;
  const timeoutSeconds = runSync ? Math.min(requested, GRAPH_LIMITS.syncTimeoutSeconds) : requested;
  const kinds = await kindsNotIndexedFor(deps.db, environmentId, config);
  const id = deps.ids.newId('grphq');
  const result = runSync
    ? await runSynchronously(deps, environmentId, config, bound, timeoutSeconds)
    : null;
  const query = await change(deps, acting, async (unit) => {
    await insertQuery(unit.tx, environmentId, {
      id,
      graphQueryTemplateId: templateId,
      graphQueryTemplateVersionId: versionId,
      params,
      timeoutSeconds,
      runSync,
    });
    const submitted = await setGraphQueryStart(unit.tx, environmentId, id, bound.startMap);
    if (submitted === null) {
      throw new Error('createGraphQuery: the new query is not submitted');
    }
    await unit.emit('graph-query.submitted', { data: queryResource(submitted, 'event', deps.dashboardPublicUrl) });
    await unit.audit({
      action: 'graph-query.submitted',
      resourceType: 'graph-query',
      resourceId: id,
      metadata: { 'graph-query-template-version-id': versionId, 'run-sync': runSync },
    });
    return result === null
      ? submitted
      : storeSynchronous(deps, unit, environmentId, id, result, kinds, deps.clock.now());
  });
  if (!runSync) {
    await enqueue(deps, environmentId, id);
  }
  return { data: queryResource(query, { mask: acting.mask }, deps.dashboardPublicUrl) };
}

/**
 * {@link createGraphQuery} in the caller's transaction, for `run_graph_query` (C127.5): always a
 * submitted query, whose run the step then waits for. `mayViewPii` is the run's grant, because a run
 * has no `Principal`, and the caller enqueues it after the commit (`enqueueGraphQuery`) and takes the
 * `graph-queries` token itself, so a 429 maps to its retryable step error (outcome 27).
 */
export async function createGraphQueryInTx(
  deps: ApiDependencies,
  { tx, emit, audit }: GraphChange,
  environmentId: string,
  mayViewPii: boolean,
  body: CreateGraphQueryBody,
): ReturnType<typeof requireGraphQuery> {
  const attributes = body.data.attributes;
  const params = attributes['parameter-map'] ?? attributes['variable-map'] ?? {};
  const templateId = attributes['graph-query-template-id'];
  const { versionId, config } = await publishedConfig(
    { ...deps, db: tx },
    environmentId,
    templateId,
  );
  const bound = bindGraphQuery(deps.blindIndexKey, environmentId, mayViewPii, config, params);
  const id = deps.ids.newId('grphq');
  await insertQuery(tx, environmentId, {
    id,
    graphQueryTemplateId: templateId,
    graphQueryTemplateVersionId: versionId,
    params,
    timeoutSeconds: attributes['timeout-in-seconds'] ?? GRAPH_LIMITS.defaultTimeoutSeconds,
    runSync: false,
  });
  const submitted = await setGraphQueryStart(tx, environmentId, id, bound.startMap);
  if (submitted === null) {
    throw new Error('createGraphQueryInTx: the new query is not submitted');
  }
  await emit('graph-query.submitted', {
    data: queryResource(submitted, 'event', deps.dashboardPublicUrl),
  });
  await audit({
    action: 'graph-query.submitted',
    resourceType: 'graph-query',
    resourceId: id,
    metadata: { 'graph-query-template-version-id': versionId, 'run-sync': false },
  });
  return submitted;
}

export { enqueue as enqueueGraphQuery };

export async function listGraphQueries(
  deps: ApiDependencies,
  acting: GraphActing,
  query: ListGraphQueriesQuery,
): Promise<z.infer<typeof graphQueryListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const page = await withCursor(() =>
    listQueryRows(
      deps.db,
      environmentId,
      {
        statuses: filterValues(query['filter[status]'], graphQueryStatusSchema),
        graphQueryTemplateIds: filterValues(
          query['filter[graph-query-template-id]'],
          idSchema('grqt'),
        ),
      },
      pageRequest(query),
    ),
  );
  return {
    data: page.items.map((row) => queryResource(row, { mask: acting.mask }, deps.dashboardPublicUrl)),
    links: {
      next: nextLink(
        GRAPH_QUERIES_PATH,
        {
          'filter[status]': query['filter[status]'],
          'filter[graph-query-template-id]': query['filter[graph-query-template-id]'],
        },
        query,
        page.next,
      ),
    },
  };
}

export async function getGraphQueryDocument(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
): Promise<GraphQueryDocument> {
  const query = await requireGraphQuery(deps.db, acting.ctx.environmentId, id);
  return { data: queryResource(query, { mask: acting.mask }, deps.dashboardPublicUrl) };
}

const redactedQuery = (id: string) =>
  new GraphProblemError('graph_query_redacted', `Graph query ${id} was redacted.`);

export async function rerunGraphQuery(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
): Promise<GraphQueryDocument> {
  const { environmentId } = acting.ctx;
  const current = await requireGraphQuery(deps.db, environmentId, id);
  const params = openGraphQueryParamsOf(current);
  if (current.redactedAt !== null || params === null) {
    throw redactedQuery(id);
  }
  if (current.status === 'submitted') {
    throw new ConflictError(`Graph query ${id} is still submitted.`);
  }
  const version = await requireGraphQueryTemplateVersion(
    deps.db,
    environmentId,
    current.graphQueryTemplateVersionId,
  );
  const config = configOf(version);
  if (config === null) {
    throw new GraphProblemError(
      'graph_template_not_published',
      `Graph query ${id}'s template version can no longer run.`,
    );
  }
  // Owner decision 20 after 7B (Workflow 9B): an expansion has no parameters; it runs again from
  // its stored start, one hop, as it first ran.
  const expansion = expansionStartOf(current.nodeMap);
  const bound: BoundGraphQuery =
    expansion === null
      ? bindGraphQuery(
          deps.blindIndexKey,
          environmentId,
          canViewPii(acting.principal),
          config,
          params,
        )
      : {
          ...startOf(current.nodeMap),
          createdAtStart: null,
          createdAtEnd: null,
          startMap: Object.fromEntries(
            Object.entries(current.nodeMap).filter(
              ([, entry]) => (entry as { start?: unknown } | null)?.start === true,
            ),
          ) as Record<string, GraphNodeMapEntry>,
        };
  const runConfig: GraphQueryTemplateConfig =
    expansion === null ? config : { ...config, 'max-hops': 2 };
  await consumeGraphQueryRate(deps, environmentId);
  const kinds = [
    ...new Set([
      ...(await kindsNotIndexedFor(deps.db, environmentId, config)),
      ...(expansion?.retired === true ? [expansion.kind] : []),
    ]),
  ];
  const result = current.runSync
    ? await runSynchronously(deps, environmentId, runConfig, bound, current.timeoutSeconds)
    : null;
  const query = await change(deps, acting, async (unit) => {
    const resubmitted = await resubmitGraphQuery(unit.tx, environmentId, id, deps.clock.now());
    const started =
      resubmitted === null
        ? null
        : await setGraphQueryStart(unit.tx, environmentId, id, bound.startMap);
    if (started === null) {
      throw redactedQuery(id);
    }
    await unit.emit('graph-query.reran', { data: queryResource(started, 'event', deps.dashboardPublicUrl) });
    await unit.audit({
      action: 'graph-query.reran',
      resourceType: 'graph-query',
      resourceId: id,
      metadata: { 'graph-query-template-version-id': version.id },
    });
    return result === null
      ? started
      : storeSynchronous(deps, unit, environmentId, id, result, kinds, deps.clock.now());
  });
  if (!current.runSync) {
    await enqueue(deps, environmentId, id);
  }
  return { data: queryResource(query, { mask: acting.mask }, deps.dashboardPublicUrl) };
}

export async function cancelGraphQuery(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
): Promise<GraphQueryDocument> {
  const { environmentId } = acting.ctx;
  const query = await change(deps, acting, async ({ tx, emit, audit }) => {
    const locked = await lockGraphQuery(tx, environmentId, id);
    if (locked === null) {
      throw new NotFoundError(`Graph query ${id} was not found.`);
    }
    const cancelled =
      locked.status === 'submitted'
        ? await cancelQueryRow(tx, environmentId, id, deps.clock.now())
        : null;
    if (cancelled === null) {
      throw new GraphProblemError(
        'graph_query_not_cancellable',
        `Graph query ${id} is ${locked.status}; only a submitted query can be cancelled.`,
      );
    }
    await emit('graph-query.cancelled', { data: queryResource(cancelled, 'event', deps.dashboardPublicUrl) });
    await audit({ action: 'graph-query.cancelled', resourceType: 'graph-query', resourceId: id });
    return cancelled;
  });
  return { data: queryResource(query, { mask: acting.mask }, deps.dashboardPublicUrl) };
}
