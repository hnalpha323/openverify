/**
 * C102 (Workflow 7B, `api-graph`): what the graph services share: the unit of work that stages
 * events and audits in one transaction, the resources, the lookups that answer 404, and the C12
 * policies `graph-queries` (per environment) and `graph-unmask` (per principal), enforced as
 * `consumeReportRate` does. A resource for an event carries no parameter, node or link (C107.5).
 */
import {
  buildGraphQueryResource,
  buildGraphQueryTemplateResource,
  buildGraphQueryTemplateVersionResource,
  graphQueryTemplateConfigSchema,
  resolveGraphQueryTemplateConfig,
  type GraphLink,
  type GraphNode,
  type GraphQueryResource,
  type GraphQueryTemplateConfig,
  type GraphQueryTemplateResource,
  type GraphQueryTemplateVersionResource,
} from '@openverify/contracts';
import { graphKindOfCode, type GraphKind } from '@openverify/core';
import {
  getGraphQuery,
  getGraphQueryTemplate,
  getGraphQueryTemplateVersion,
  listCurrentGraphQueryTemplateVersions,
  openGraphQueryParamsOf,
  type Db,
  type GraphQueryRow,
  type GraphQueryTemplateRow,
  type GraphQueryTemplateVersionRow,
} from '@openverify/db';
import type { PiiMask } from '../../auth/pii.js';
import { NotFoundError, RateLimitedError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { rateLimitRules } from '../../plugins/rate-limit.js';
import type { Principal, PublishEventInput } from '../../ports.js';
import { auditEntryOf, type ApiDependencies, type AuditedAction } from '../context.js';
import type { GraphActing } from './acting.js';

export const GRAPH_QUERIES_PATH = '/api/v1/graph-queries';
export const GRAPH_QUERY_TEMPLATES_PATH = '/api/v1/graph-query-templates';

export interface GraphChange {
  tx: Db;
  emit: (name: PublishEventInput['name'], payload: PublishEventInput['payload']) => Promise<void>;
  audit: (action: AuditedAction) => Promise<void>;
}

/** One transaction; its events are dispatched after the commit (C5). */
export async function change<T>(
  deps: ApiDependencies,
  acting: GraphActing,
  work: (change: GraphChange) => Promise<T>,
): Promise<T> {
  const staged: StagedEvent[] = [];
  const result = await deps.db.transaction((tx) =>
    work(graphChangeIn(tx, deps, acting, staged)),
  );
  await deps.events.dispatch(staged);
  return result;
}

/** C117.5: a change in the caller's transaction, whose events land in `staged`. */
export function graphChangeIn(
  tx: Db,
  deps: Pick<ApiDependencies, 'events' | 'audit'>,
  acting: Pick<GraphActing, 'ctx' | 'actor'>,
  staged: StagedEvent[],
): GraphChange {
  const { environmentId } = acting.ctx;
  return {
    tx,
    emit: async (name, payload) => {
      staged.push(await deps.events.stage(tx, { environmentId, name, payload }));
    },
    audit: (action) => deps.audit.record(tx, auditEntryOf(acting.ctx, acting.actor, action)),
  };
}

// Lookups ----------------------------------------------------------------------------------

export async function requireGraphQueryTemplate(
  db: Db,
  environmentId: string,
  id: string,
): Promise<GraphQueryTemplateRow> {
  const template = await getGraphQueryTemplate(db, environmentId, id);
  if (template === null) {
    throw new NotFoundError(`Graph query template ${id} was not found.`);
  }
  return template;
}

export async function requireGraphQueryTemplateVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<GraphQueryTemplateVersionRow> {
  const version = await getGraphQueryTemplateVersion(db, environmentId, id);
  if (version === null) {
    throw new NotFoundError(`Graph query template version ${id} was not found.`);
  }
  return version;
}

export async function requireGraphQuery(
  db: Db,
  environmentId: string,
  id: string,
): Promise<GraphQueryRow> {
  const query = await getGraphQuery(db, environmentId, id);
  if (query === null) {
    throw new NotFoundError(`Graph query ${id} was not found.`);
  }
  return query;
}

/** A stored version's config, every default applied; `null` when it no longer parses. */
export function configOf(version: GraphQueryTemplateVersionRow): GraphQueryTemplateConfig | null {
  const parsed = graphQueryTemplateConfigSchema.safeParse(version.config);
  return parsed.success ? resolveGraphQueryTemplateConfig(parsed.data) : null;
}

// Resources --------------------------------------------------------------------------------

export async function templateResources(
  db: Db,
  environmentId: string,
  templates: readonly GraphQueryTemplateRow[],
): Promise<GraphQueryTemplateResource[]> {
  const current = await listCurrentGraphQueryTemplateVersions(
    db,
    environmentId,
    templates.map(({ id }) => id),
  );
  return templates.map((template) => {
    const versions = current.get(template.id);
    return buildGraphQueryTemplateResource({
      id: template.id,
      name: template.name,
      status: template.status,
      latestVersion: versions?.latest.version ?? 1,
      publishedVersion: versions?.published?.version ?? null,
      publishedVersionId: versions?.published?.id ?? null,
      ...(versions === undefined ? {} : { latestVersionId: versions.latest.id }),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    });
  });
}

export function versionResource(
  version: GraphQueryTemplateVersionRow,
): GraphQueryTemplateVersionResource {
  return buildGraphQueryTemplateVersionResource({
    id: version.id,
    templateId: version.graphQueryTemplateId,
    versionNumber: version.version,
    status: version.status,
    config: version.config as GraphQueryTemplateConfig,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
  });
}

/**
 * C102.4: the console's page of a result, on the resolved `OPENVERIFY_DASHBOARD_PUBLIC_URL`; `null`
 * without one, so a production without it never points at `localhost` (owner decision 13 after
 * Workflow 7B).
 */
export function explorerUrlOf(id: string, dashboardPublicUrl: string | undefined): string | null {
  return dashboardPublicUrl !== undefined && URL.canParse(dashboardPublicUrl)
    ? new URL(`/graph/${id}`, dashboardPublicUrl).toString()
    : null;
}

/**
 * The resource of a query. With `mask`, its params as the principal may see them, member-wise;
 * for an event, `null` params and no nodes or links (C107.5).
 */
export function queryResource(
  query: GraphQueryRow,
  view: { mask: PiiMask } | 'event',
  dashboardPublicUrl: string | undefined,
): GraphQueryResource {
  const event = view === 'event';
  const params = event ? null : openGraphQueryParamsOf(query);
  return buildGraphQueryResource({
    id: query.id,
    status: query.status,
    params: params === null || event ? null : view.mask.fields(params),
    createdAt: query.createdAt,
    updatedAt: query.updatedAt,
    erroredAt: query.erroredAt,
    completedAt: query.completedAt,
    redactedAt: query.redactedAt,
    explorerUrl: explorerUrlOf(query.id, dashboardPublicUrl),
    nodeLimitReached: query.nodeLimitReached,
    nodes: event ? [] : (query.nodes as GraphNode[]),
    links: event ? [] : (query.links as GraphLink[]),
    kindsNotIndexed: query.kindsNotIndexed
      .map(graphKindOfCode)
      .filter((kind): kind is GraphKind => kind !== null),
    skippedHubValues: query.skippedHubValues,
    templateVersionId: query.graphQueryTemplateVersionId,
    accountIds: query.accountIds,
  });
}

/** The event of a query's move, named for its status (C102.5). */
export const STATUS_EVENTS = {
  submitted: 'graph-query.submitted',
  completed: 'graph-query.completed',
  errored: 'graph-query.errored',
  cancelled: 'graph-query.cancelled',
  timed_out: 'graph-query.timed-out',
} as const;

// C12 policies -----------------------------------------------------------------------------

async function consume(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  policy: 'graph-queries' | 'graph-unmask',
  subject: string,
  detail: string,
): Promise<void> {
  let decision;
  try {
    decision = await deps.rateLimiter.consume(`${policy}:${subject}`, rateLimitRules()[policy]);
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError(detail, decision.retryAfterSeconds);
  }
}

/** C107.3: one run of the environment (`graph-queries`, 30 a minute). */
export function consumeGraphQueryRate(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  environmentId: string,
): Promise<void> {
  return consume(
    deps,
    'graph-queries',
    environmentId,
    'This environment ran too many graph queries; retry later.',
  );
}

/** The id a per-principal limit keys on. */
export function principalIdOf(principal: Principal): string {
  return principal.kind === 'api-key' ? principal.apiKeyId : principal.userId;
}

/** C102.6, C107.3: one unmask of the principal (`graph-unmask`, 60 a minute). */
export function consumeGraphUnmaskRate(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  principal: Principal,
): Promise<void> {
  return consume(
    deps,
    'graph-unmask',
    principalIdOf(principal),
    'Too many graph values were unmasked; retry later.',
  );
}
