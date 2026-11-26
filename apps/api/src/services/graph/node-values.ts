/**
 * C102.6 (Workflow 7B; P17): the audited unmask of one property node. It resolves the node through
 * the stored result's node map, opens one source of that value among the result's accounts (the
 * same reading the indexer keyed, `collect.ts`), writes an audit entry naming the query, the node
 * and its kind, never the value, and answers the plaintext, a PII response member. A start node
 * answers the parameter the searcher bound. `pii:view` is checked by the route; the C12 policy
 * `graph-unmask` (60 a minute per principal) here, first. A redacted query answers 410
 * `graph_query_redacted`, a node not in the result 404 `graph_node_not_found`; a value no source
 * still gives (a rotated key, a chip signature) answers `null`. Owner: `api-graph`.
 */
import type { GraphNode, GraphNodeValueDocument } from '@openverify/contracts';
import { graphKindOfCode, type GraphKind } from '@openverify/core';
import {
  getAccount,
  getEnvironment,
  getInquiry,
  listGraphValueSources,
  openGraphQueryParamsOf,
  type GraphAttributeRow,
  type GraphQueryRow,
} from '@openverify/db';
import { GraphProblemError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import type { GraphActing } from './acting.js';
import { accountGraphValues, inquiryGraphValues, type GraphValue } from './collect.js';
import type { GraphNodeMapEntry } from './query.js';
import type { GraphSettings } from './settings.js';
import { change, consumeGraphUnmaskRate, requireGraphQuery } from './shared.js';

const MAX_VALUE_LENGTH = 1024;

/** What one source of a result still gives, under every kind (the reading is the unmask's). */
async function valuesOfSource(
  deps: ApiDependencies,
  settings: GraphSettings,
  row: GraphAttributeRow,
): Promise<GraphValue[]> {
  const { environmentId } = row;
  if (row.sourceType === 'account') {
    const account = await getAccount(deps.db, environmentId, row.sourceId);
    return account === null
      ? []
      : accountGraphValues(deps.blindIndexKey, environmentId, settings, account);
  }
  const inquiry =
    row.inquiryId === null ? null : await getInquiry(deps.db, environmentId, row.inquiryId);
  return inquiry === null
    ? []
    : (await inquiryGraphValues(deps.db, deps.blindIndexKey, settings, inquiry)).filter(
        ({ source }) => source.id === row.sourceId,
      );
}

/** The plaintext of a value of the result, from the first source that still gives it. */
export async function openGraphValue(
  deps: ApiDependencies,
  query: GraphQueryRow,
  kind: GraphKind,
  entry: { kind: number; valueKey: string },
): Promise<string | null> {
  const environment = await getEnvironment(deps.db, query.environmentId);
  if (environment === null) {
    return null;
  }
  const settings: GraphSettings = {
    indexing: true,
    weakKinds: true,
    deviceRecognition: true,
    components: false,
    sandbox: environment.kind === 'sandbox',
  };
  const sources = await listGraphValueSources(deps.db, query.environmentId, {
    kind: entry.kind,
    valueKey: entry.valueKey,
    accountIds: query.accountIds,
  });
  for (const source of sources) {
    const found = (await valuesOfSource(deps, settings, source)).find(
      (value) => value.kind === kind && value.valueKey === entry.valueKey,
    );
    if (found !== undefined) {
      return found.display;
    }
  }
  return null;
}

/** The node's map entry, when it is a property node of the stored result. */
export function propertyNodeOf(
  query: GraphQueryRow,
  nodeId: string,
): { kind: GraphKind; entry: Extract<GraphNodeMapEntry, { kind: number }> } | null {
  const entry = query.nodeMap[nodeId] as GraphNodeMapEntry | undefined;
  const inResult = (query.nodes as GraphNode[]).some(
    (node) => node.type !== 'account' && node.value === nodeId,
  );
  if (entry === undefined || !('kind' in entry) || !inResult) {
    return null;
  }
  const kind = graphKindOfCode(entry.kind);
  return kind === null ? null : { kind, entry };
}

export async function getGraphNodeValue(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
  nodeId: string,
): Promise<GraphNodeValueDocument> {
  await consumeGraphUnmaskRate(deps, acting.principal);
  const query = await requireGraphQuery(deps.db, acting.ctx.environmentId, id);
  if (query.redactedAt !== null) {
    throw new GraphProblemError('graph_query_redacted', `Graph query ${id} was redacted.`);
  }
  const node = propertyNodeOf(query, nodeId);
  if (node === null) {
    throw new GraphProblemError(
      'graph_node_not_found',
      `Graph query ${id} has no property node ${nodeId}.`,
    );
  }
  const { kind, entry } = node;
  const bound =
    entry.start === true && entry.parameter !== undefined
      ? (openGraphQueryParamsOf(query)?.[entry.parameter] ?? null)
      : null;
  const value = bound ?? (await openGraphValue(deps, query, kind, entry));
  await change(deps, acting, async ({ audit }) => {
    await audit({
      action: 'graph-query.node-unmasked',
      resourceType: 'graph-query',
      resourceId: id,
      metadata: { 'node-id': nodeId, kind, found: value !== null },
    });
  });
  return {
    data: {
      type: 'graph-node-value',
      id: nodeId,
      attributes: {
        kind,
        value: value === null || value === '' ? null : value.slice(0, MAX_VALUE_LENGTH),
      },
    },
  };
}
