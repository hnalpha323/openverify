/**
 * C102.1 (Workflow 7B): the graph query template routes' service. A template comes with its first
 * draft version, holding the body's config or, without one, the account in context over the strong
 * kinds (a config that publishes as it is). `PATCH` renames; `DELETE` archives, and an archived
 * template runs no new query. Every write is audited with ids and names only. Owner: `api-graph`.
 */
import {
  filterValues,
  type CreateGraphQueryTemplateBody,
  type GraphQueryTemplateConfig,
  type GraphQueryTemplateDocument,
  type UpdateGraphQueryTemplateBody,
  type graphQueryTemplateListDocumentSchema,
  type listGraphQueryTemplatesQuerySchema,
} from '@openverify/contracts';
import { GRAPH_STRONG_KINDS, graphTemplateStatusSchema } from '@openverify/core';
import {
  createGraphQueryTemplate as insertTemplate,
  listGraphQueryTemplates as listTemplateRows,
  updateGraphQueryTemplate as updateTemplateRow,
  type GraphQueryTemplateRow,
} from '@openverify/db';
import type { z } from 'zod';
import { NotFoundError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { GraphActing } from './acting.js';
import {
  change,
  GRAPH_QUERY_TEMPLATES_PATH,
  requireGraphQueryTemplate,
  templateResources,
} from './shared.js';

export type ListGraphQueryTemplatesQuery = z.infer<typeof listGraphQueryTemplatesQuerySchema>;

/** Ours: the draft of a template created without a config. */
export const DEFAULT_GRAPH_TEMPLATE_CONFIG: GraphQueryTemplateConfig = {
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': [...GRAPH_STRONG_KINDS],
};

async function documentOf(
  deps: ApiDependencies,
  environmentId: string,
  template: GraphQueryTemplateRow,
): Promise<GraphQueryTemplateDocument> {
  const [data] = await templateResources(deps.db, environmentId, [template]);
  if (data === undefined) {
    throw new Error('documentOf: no resource was built');
  }
  return { data };
}

/** A template comes with its first draft version (`graph:write`). */
export async function createGraphQueryTemplate(
  deps: ApiDependencies,
  acting: GraphActing,
  attributes: CreateGraphQueryTemplateBody['data']['attributes'],
): Promise<GraphQueryTemplateDocument> {
  const { environmentId } = acting.ctx;
  const template = await change(deps, acting, async ({ tx, audit }) => {
    const versionId = deps.ids.newId('grqtv');
    const created = await insertTemplate(tx, environmentId, {
      id: deps.ids.newId('grqt'),
      name: attributes.name,
      version: {
        id: versionId,
        config: { ...(attributes.config ?? DEFAULT_GRAPH_TEMPLATE_CONFIG) },
      },
    });
    await audit({
      action: 'graph-query-template.created',
      resourceType: 'graph-query-template',
      resourceId: created.id,
      metadata: { 'graph-query-template-version-id': versionId },
    });
    return created;
  });
  return documentOf(deps, environmentId, template);
}

export async function listGraphQueryTemplates(
  deps: ApiDependencies,
  acting: GraphActing,
  query: ListGraphQueryTemplatesQuery,
): Promise<z.infer<typeof graphQueryTemplateListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const page = await withCursor(() =>
    listTemplateRows(
      deps.db,
      environmentId,
      { statuses: filterValues(query['filter[status]'], graphTemplateStatusSchema) },
      pageRequest(query),
    ),
  );
  return {
    data: await templateResources(deps.db, environmentId, page.items),
    links: {
      next: nextLink(
        GRAPH_QUERY_TEMPLATES_PATH,
        { 'filter[status]': query['filter[status]'] },
        query,
        page.next,
      ),
    },
  };
}

export async function getGraphQueryTemplateDocument(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
): Promise<GraphQueryTemplateDocument> {
  const { environmentId } = acting.ctx;
  return documentOf(
    deps,
    environmentId,
    await requireGraphQueryTemplate(deps.db, environmentId, id),
  );
}

async function changeTemplate(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
  changes: { name?: string; status?: 'archived' },
  action: string,
): Promise<GraphQueryTemplateDocument> {
  const { environmentId } = acting.ctx;
  const template = await change(deps, acting, async ({ tx, audit }) => {
    const updated = await updateTemplateRow(tx, environmentId, id, changes);
    if (updated === null) {
      throw new NotFoundError(`Graph query template ${id} was not found.`);
    }
    await audit({
      action,
      resourceType: 'graph-query-template',
      resourceId: id,
      metadata: { attributes: Object.keys(changes) },
    });
    return updated;
  });
  return documentOf(deps, environmentId, template);
}

/** The name only; the config is a version's. */
export function updateGraphQueryTemplate(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
  attributes: UpdateGraphQueryTemplateBody['data']['attributes'],
): Promise<GraphQueryTemplateDocument> {
  return changeTemplate(
    deps,
    acting,
    id,
    { name: attributes.name },
    'graph-query-template.updated',
  );
}

/** `DELETE`: an archived template runs no new query; templates are never deleted. */
export function archiveGraphQueryTemplate(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
): Promise<GraphQueryTemplateDocument> {
  return changeTemplate(deps, acting, id, { status: 'archived' }, 'graph-query-template.archived');
}
