/**
 * C102.1, C102.2 (Workflow 7B): the graph query template version routes' service, as C71: a draft
 * changes, publishing (under the template lock) refuses what `graphTemplateConfigProblems` names
 * (`weak_kind_not_allowed`, `graph_parameter_unbound`, each with a pointer into the config) and
 * supersedes the published version. Owner: `api-graph`.
 */
import {
  filterValues,
  graphQueryTemplateConfigSchema,
  graphTemplateConfigProblems,
  idSchema,
  type CreateGraphQueryTemplateVersionBody,
  type GraphQueryTemplateVersionDocument,
  type GraphQueryTemplateVersionListDocument,
  type ListGraphQueryTemplateVersionsQuery,
  type UpdateGraphQueryTemplateVersionBody,
} from '@openverify/contracts';
import {
  createGraphQueryTemplateVersion as insertVersion,
  listGraphQueryTemplateVersions as listVersionRows,
  publishGraphQueryTemplateVersion as publishVersionRow,
  updateGraphQueryTemplateVersionDraft,
} from '@openverify/db';
import { GraphProblemError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { GraphActing } from './acting.js';
import {
  change,
  requireGraphQueryTemplate,
  requireGraphQueryTemplateVersion,
  versionResource,
} from './shared.js';

const notDraft = (id: string) =>
  new GraphProblemError(
    'graph_template_version_not_draft',
    `Graph query template version ${id} is no longer a draft.`,
  );

/** Owner decision 7 after Workflow 7B: `GET /graph-query-template-versions`, newest first. */
export async function listGraphQueryTemplateVersions(
  { db }: ApiDependencies,
  acting: GraphActing,
  query: ListGraphQueryTemplateVersionsQuery,
): Promise<GraphQueryTemplateVersionListDocument> {
  const filter = { 'filter[graph-query-template-id]': query['filter[graph-query-template-id]'] };
  const page = await withCursor(() =>
    listVersionRows(db, acting.ctx.environmentId, {
      ...pageRequest(query),
      templateIds: filterValues(filter['filter[graph-query-template-id]'], idSchema('grqt')),
    }),
  );
  return {
    data: page.items.map(versionResource),
    links: { next: nextLink('/api/v1/graph-query-template-versions', filter, query, page.next) },
  };
}

export async function createGraphQueryTemplateVersion(
  deps: ApiDependencies,
  acting: GraphActing,
  attributes: CreateGraphQueryTemplateVersionBody['data']['attributes'],
): Promise<GraphQueryTemplateVersionDocument> {
  const { environmentId } = acting.ctx;
  const templateId = attributes['graph-query-template-id'];
  const template = await requireGraphQueryTemplate(deps.db, environmentId, templateId);
  if (template.status === 'archived') {
    throw new GraphProblemError(
      'graph_template_archived',
      `Graph query template ${templateId} is archived.`,
    );
  }
  const version = await change(deps, acting, async ({ tx, audit }) => {
    const created = await insertVersion(tx, environmentId, {
      id: deps.ids.newId('grqtv'),
      graphQueryTemplateId: templateId,
      config: { ...attributes.config },
    });
    await audit({
      action: 'graph-query-template-version.created',
      resourceType: 'graph-query-template-version',
      resourceId: created.id,
      metadata: { 'graph-query-template-id': templateId },
    });
    return created;
  });
  return { data: versionResource(version) };
}

export async function getGraphQueryTemplateVersionDocument(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
): Promise<GraphQueryTemplateVersionDocument> {
  return {
    data: versionResource(
      await requireGraphQueryTemplateVersion(deps.db, acting.ctx.environmentId, id),
    ),
  };
}

/** Drafts only: 409 `graph_template_version_not_draft` otherwise. */
export async function updateGraphQueryTemplateVersion(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
  attributes: UpdateGraphQueryTemplateVersionBody['data']['attributes'],
): Promise<GraphQueryTemplateVersionDocument> {
  const { environmentId } = acting.ctx;
  await requireGraphQueryTemplateVersion(deps.db, environmentId, id);
  const version = await change(deps, acting, async ({ tx, audit }) => {
    const updated = await updateGraphQueryTemplateVersionDraft(tx, environmentId, id, {
      ...attributes.config,
    });
    if (updated === null) {
      throw notDraft(id);
    }
    await audit({
      action: 'graph-query-template-version.updated',
      resourceType: 'graph-query-template-version',
      resourceId: id,
      metadata: { attributes: ['config'] },
    });
    return updated;
  });
  return { data: versionResource(version) };
}

export async function publishGraphQueryTemplateVersion(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
): Promise<GraphQueryTemplateVersionDocument> {
  const { environmentId } = acting.ctx;
  const current = await requireGraphQueryTemplateVersion(deps.db, environmentId, id);
  if (current.status !== 'draft') {
    throw notDraft(id);
  }
  const config = graphQueryTemplateConfigSchema.parse(current.config);
  const problems = graphTemplateConfigProblems(config);
  const [first] = problems;
  if (first !== undefined) {
    throw new GraphProblemError(first.code, 'The template version cannot be published.', {
      errors: problems.map(({ code, pointer }) => ({
        location: 'body',
        pointer: `/data/attributes/config${pointer}`,
        detail: code,
      })),
    });
  }
  const version = await change(deps, acting, async ({ tx, audit }) => {
    const published = await publishVersionRow(tx, environmentId, id, deps.clock.now());
    if (published === null) {
      throw notDraft(id);
    }
    await audit({
      action: 'graph-query-template-version.published',
      resourceType: 'graph-query-template-version',
      resourceId: id,
      metadata: { 'graph-query-template-id': published.graphQueryTemplateId },
    });
    return published;
  });
  return { data: versionResource(version) };
}
