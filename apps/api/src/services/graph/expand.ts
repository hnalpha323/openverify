/**
 * Owner decision 20 after Workflow 7B, built in Workflow 9B by `api-cases-reports` (contracts B42;
 * `foundation-9b` froze the route in `routes/server/graph-queries.ts`, C11):
 * `POST /api/v1/graph-queries/:id/nodes/:nodeId/expand` (`graph:write`).
 *
 * - **The start.** The node's `{ kind, valueKey, keyId }` is read from the source query's `node_map`
 *   on the server; no sealed value is opened and no value key is sent (P17). The new query starts
 *   from that stored key, its start node keeping the expanded node's id, so the console merges it
 *   onto the node it expanded.
 * - **One hop**: the accounts holding the value, through 7B's own engine (`searchGraph`, called, not
 *   changed) under the source's pinned template version, its account filters (no created-at window:
 *   an expansion binds no parameter), the fan-out cap with its hub rule, and the node limit.
 * - **A retired key.** A key made under a blind-index key that is no longer current (after
 *   `blind-index:rebuild`) cannot be found in today's index: the run searches nothing and lists the
 *   node's kind in `kinds-not-indexed` (`index-complete: false`), the honest empty state, never "no
 *   accounts" read as complete.
 * - **Refusals**: an unknown query or node 404, a redacted source 410 (`graph_query_redacted`), an
 *   account node 422 (an account is expanded by running a template with `account_id` bound), a kind
 *   in `GRAPH_PERSON_KINDS` without `pii:view` 403 (C102.4's rule for parameters), the
 *   `graph-queries` policy 429, a busy synchronous slot 429 `graph_sync_limited`.
 * - **As a run**: stored with `params` `{}` (an expansion binds none), `graph-query.submitted` and
 *   its audit entry naming the template version, `run-sync` and the source (`expanded-from`), then
 *   with `meta.run-sync` the result and its terminal event and audit; otherwise it is enqueued and
 *   the job runs it (and audits it as the system). Retention (`graph-query-retention-days`) redacts
 *   it as any query.
 *
 * {@link isExpansionStart} names an expansion's start (a start value bound by no parameter), so the
 * job and the rerun can keep it to one hop (a hook for `integration-9b`, see the plan amendment).
 */
import type { ExpandGraphNodeBody, GraphQueryDocument } from '@openverify/contracts';
import { GRAPH_LIMITS, GRAPH_PERSON_KINDS, graphKindOfCode } from '@openverify/core';
import {
  blindIndexKeyId,
  createGraphQuery as insertQuery,
  setGraphQueryStart,
  storeGraphQueryResult,
} from '@openverify/db';
import { canViewPii } from '../../auth/pii.js';
import {
  ConflictError,
  GraphProblemError,
  NotFoundError,
  PermissionDeniedError,
  UnprocessableContentError,
} from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import type { GraphActing } from './acting.js';
import { countsOf, enqueueGraphQuery, filtersOf, kindsNotIndexedFor, resultOf } from './queries.js';
import {
  searchGraph,
  synchronousClaim,
  type GraphNodeMapEntry,
  type GraphSearchResult,
} from './query.js';
import {
  change,
  configOf,
  consumeGraphQueryRate,
  queryResource,
  requireGraphQuery,
  requireGraphQueryTemplateVersion,
  STATUS_EVENTS,
} from './shared.js';

export type ExpandGraphNode = (
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
  nodeId: string,
  body: ExpandGraphNodeBody,
) => Promise<GraphQueryDocument>;

export { expansionStartOf, isExpansionStart } from './expansion-start.js';

interface StoredValue {
  kind: number;
  valueKey: string;
  keyId?: string;
  account?: boolean;
  start?: boolean;
  parameter?: string;
}

/** The stored property node, or the refusal that answers for it. */
function storedNode(nodeMap: Readonly<Record<string, unknown>>, nodeId: string): StoredValue {
  const entry = Object.hasOwn(nodeMap, nodeId)
    ? (nodeMap[nodeId] as Partial<StoredValue> | null | undefined)
    : null;
  if (entry === null || entry === undefined) {
    throw new NotFoundError(`Graph node ${nodeId} was not found.`);
  }
  if (entry.account === true) {
    throw new UnprocessableContentError(
      'An account node is expanded by running a template with account_id bound.',
      [{ location: 'params', pointer: '/nodeId', detail: 'names an account node' }],
    );
  }
  if (typeof entry.kind !== 'number' || typeof entry.valueKey !== 'string') {
    throw new NotFoundError(`Graph node ${nodeId} was not found.`);
  }
  return entry as StoredValue;
}

export const expandGraphNode: ExpandGraphNode = async (deps, acting, id, nodeId, body) => {
  const { environmentId } = acting.ctx;
  const source = await requireGraphQuery(deps.db, environmentId, id);
  if (source.redactedAt !== null) {
    throw new GraphProblemError('graph_query_redacted', `Graph query ${id} was redacted.`);
  }
  const node = storedNode(source.nodeMap, nodeId);
  const kind = graphKindOfCode(node.kind);
  if (kind === null) {
    throw new NotFoundError(`Graph node ${nodeId} was not found.`);
  }
  if (GRAPH_PERSON_KINDS.includes(kind) && !canViewPii(acting.principal)) {
    throw new PermissionDeniedError('Expanding a node that identifies a person needs pii:view.', [
      'pii:view',
    ]);
  }
  const version = await requireGraphQueryTemplateVersion(
    deps.db,
    environmentId,
    source.graphQueryTemplateVersionId,
  );
  const config = configOf(version);
  if (config === null) {
    throw new GraphProblemError(
      'graph_template_not_published',
      `Graph query ${id}'s template version can no longer run.`,
    );
  }
  await consumeGraphQueryRate(deps, environmentId);
  const keyId = node.keyId ?? '';
  const current = keyId === '' || keyId === blindIndexKeyId(deps.blindIndexKey);
  const runSync = body.meta?.['run-sync'] === true;
  const kinds = [
    ...new Set([
      ...(await kindsNotIndexedFor(deps.db, environmentId, config)),
      ...(current ? [] : [node.kind]),
    ]),
  ];
  const startMap: Record<string, GraphNodeMapEntry> = {
    [nodeId]: { kind: node.kind, valueKey: node.valueKey, keyId, start: true },
  };
  const timeoutSeconds = runSync
    ? Math.min(source.timeoutSeconds, GRAPH_LIMITS.syncTimeoutSeconds)
    : source.timeoutSeconds;
  let result: GraphSearchResult | null = null;
  if (runSync && !current) {
    // A retired key: today's index cannot hold it, so nothing is searched (its kind is listed).
    result = {
      nodes: [{ type: kind, value: nodeId }],
      links: [],
      nodeMap: startMap,
      accountIds: [],
      skippedHubValues: 0,
      nodeLimitReached: false,
      timedOut: false,
    };
  } else if (runSync) {
    const now = () => deps.clock.now().getTime();
    result = await searchGraph(
      deps.db,
      {
        environmentId,
        // One hop: a start value is hop 0 and its holders hop 1; at two hops nothing goes past them.
        config: { ...config, 'max-hops': 2 },
        startAccounts: [],
        startValues: [{ nodeId, kind, valueKey: node.valueKey, keyId, parameter: '' }],
        filters: filtersOf(config, { createdAtStart: null, createdAtEnd: null }),
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
  }
  const newId = deps.ids.newId('grphq');
  const query = await change(deps, acting, async (unit) => {
    await insertQuery(unit.tx, environmentId, {
      id: newId,
      graphQueryTemplateId: source.graphQueryTemplateId,
      graphQueryTemplateVersionId: source.graphQueryTemplateVersionId,
      params: {},
      timeoutSeconds,
      runSync,
    });
    const submitted = await setGraphQueryStart(unit.tx, environmentId, newId, startMap);
    if (submitted === null) {
      throw new Error('expandGraphNode: the new query is not submitted');
    }
    await unit.emit('graph-query.submitted', {
      data: queryResource(submitted, 'event', deps.dashboardPublicUrl),
    });
    await unit.audit({
      action: 'graph-query.submitted',
      resourceType: 'graph-query',
      resourceId: newId,
      metadata: {
        'graph-query-template-version-id': source.graphQueryTemplateVersionId,
        'run-sync': runSync,
        'expanded-from': id,
      },
    });
    if (result === null) {
      return submitted;
    }
    const stored = await storeGraphQueryResult(
      unit.tx,
      environmentId,
      newId,
      resultOf(result, kinds, deps.clock.now()),
    );
    if (stored === null) {
      throw new ConflictError(`Graph query ${newId} is no longer submitted.`);
    }
    await unit.emit(STATUS_EVENTS[stored.status], {
      data: queryResource(stored, 'event', deps.dashboardPublicUrl),
    });
    await unit.audit({
      action: STATUS_EVENTS[stored.status],
      resourceType: 'graph-query',
      resourceId: newId,
      metadata: countsOf(stored),
    });
    return stored;
  });
  if (!runSync) {
    await enqueueGraphQuery(deps, environmentId, newId);
  }
  return { data: queryResource(query, { mask: acting.mask }, deps.dashboardPublicUrl) };
};
