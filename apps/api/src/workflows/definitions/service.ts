/**
 * C112, C113, C116: workflows, their one draft and their versions. Publishing, rollout, restore and
 * promote are user-only (C121.2) and live in `../publish/`; this file answers the routes.
 *
 * - `PATCH` changes the name and the description alone, and an archived workflow changes no more.
 * - `PUT /draft` runs the graph check in its `draft` mode and refuses what it refuses, at the
 *   definition's `lock-version` (409 `version_locked`), and is locked during a rollout (C116.3). With
 *   no draft, `lock-version: 0` opens the next one.
 * - `POST /draft/validate` saves nothing and holds a definition to what publish will hold it to.
 * - Publishing never starts a paused workflow: `POST /activate` does, and only once a version is
 *   published. A workflow paused by the publisher-rights sweep waits for a republish (C121.5).
 */
import {
  filterValues,
  idSchema,
  workflowDefinitionSchema,
  workflowIncludeSchema,
  type CreateWorkflowBody,
  type PutWorkflowDraftBody,
  type UpdateWorkflowBody,
  type ValidateWorkflowDraftBody,
  type WorkflowDefinition,
  type WorkflowDefinitionCheckDocument,
  type WorkflowDocument,
  type WorkflowIncludeDocument,
  type WorkflowVersionDiffDocument,
  type WorkflowVersionDocument,
  type getWorkflowQuerySchema,
  type listWorkflowVersionsQuerySchema,
  type listWorkflowsQuerySchema,
  type workflowListDocumentSchema,
  type workflowVersionDiffQuerySchema,
  type workflowVersionListDocumentSchema,
} from '@openverify/contracts';
import { workflowKindSchema, workflowStatusSchema } from '@openverify/core';
import {
  archiveWorkflowVersion,
  cancelScheduledRunsForWorkflow,
  createWorkflowDraft,
  createWorkflow as createWorkflowRow,
  listPublishedWorkflowVersions,
  listWorkflowVersions as listVersionRows,
  listWorkflows as listWorkflowRows,
  replaceWorkflowSchedule,
  replaceWorkflowTriggers,
  setWorkflowDeploymentStatus,
  setWorkflowStatus,
  setWorkflowVersionPointers,
  updateWorkflow as updateWorkflowRow,
  type Db,
  type WorkflowRow,
} from '@openverify/db';
import { checkDefinition, readDefinition, validateDefinition } from '@openverify/workflow-engine';
import type { z } from 'zod';
import { ConflictError, NotFoundError } from '../../errors.js';
import { nextLink, pageRequest, withCursor } from '../../services/pagination.js';
import type { ApiDependencies } from '../../services/context.js';
import { change } from '../../services/transactions/shared.js';
import type { WorkflowActing } from '../acting.js';
import { workflowAudit } from './audit.js';
import { loadCheckContext } from './context.js';
import { diffDefinitions } from './diff.js';
import { WORKFLOW_API_PATHS } from './paths.js';
import {
  activeDeployment,
  workflowDeploymentResource,
  workflowResource,
  workflowVersionResource,
} from './resources.js';
import {
  assertNoRollout,
  definitionInvalid,
  draftMissing,
  held,
  requireLockedWorkflow,
  requireWorkflow,
  requireWorkflowVersion,
  versionDocument,
  writeDraft,
} from './shared.js';

export { publishWorkflow } from '../publish/publish.js';
export { promoteWorkflow } from '../publish/promote.js';
export { restoreWorkflow, rolloutWorkflow } from '../publish/rollout.js';

export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;
export type GetWorkflowQuery = z.infer<typeof getWorkflowQuerySchema>;
export type ListWorkflowVersionsQuery = z.infer<typeof listWorkflowVersionsQuerySchema>;
export type WorkflowVersionDiffQuery = z.infer<typeof workflowVersionDiffQuerySchema>;

/** C113.1: what a new workflow's draft holds. */
const EMPTY_DEFINITION: WorkflowDefinition = {
  'schema-version': 1,
  trigger: null,
  inputs: [],
  variables: [],
  steps: [],
  edges: [],
  outputs: [],
  layout: {},
};

export async function createWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  body: CreateWorkflowBody,
): Promise<WorkflowDocument> {
  const { environmentId } = acting.ctx;
  const { name, description, kind = 'workflow' } = body.data.attributes;
  const workflow = await change(deps, acting, async ({ tx, audit }) => {
    const id = deps.ids.newId('wfl');
    await createWorkflowRow(tx, environmentId, { id, name, description, kind });
    const draftVersionId = deps.ids.newId('wfv');
    await createWorkflowDraft(tx, environmentId, {
      id: draftVersionId,
      workflowId: id,
      versionNumber: 1,
      schemaVersion: EMPTY_DEFINITION['schema-version'],
      definition: EMPTY_DEFINITION,
      lastUpdater: acting.actor.id,
    });
    const row = await setWorkflowVersionPointers(tx, environmentId, id, { draftVersionId });
    await audit(workflowAudit('workflow.created', id, { kind }));
    return held(row);
  });
  return { data: workflowResource(workflow) };
}

export async function listWorkflows(
  deps: ApiDependencies,
  acting: WorkflowActing,
  query: ListWorkflowsQuery,
): Promise<z.infer<typeof workflowListDocumentSchema>> {
  const page = await withCursor(() =>
    listWorkflowRows(
      deps.db,
      acting.ctx.environmentId,
      {
        statuses: filterValues(query['filter[status]'], workflowStatusSchema),
        kinds: filterValues(query['filter[kind]'], workflowKindSchema),
      },
      pageRequest(query),
    ),
  );
  return {
    data: page.items.map(workflowResource),
    links: {
      next: nextLink(
        WORKFLOW_API_PATHS.workflows,
        { 'filter[status]': query['filter[status]'], 'filter[kind]': query['filter[kind]'] },
        query,
        page.next,
      ),
    },
  };
}

export async function getWorkflowDocument(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  query: GetWorkflowQuery,
): Promise<WorkflowIncludeDocument> {
  const { environmentId } = acting.ctx;
  const workflow = await requireWorkflow(deps.db, environmentId, id);
  const data = workflowResource(workflow);
  const includes = filterValues(query.include, workflowIncludeSchema) ?? [];
  if (includes.length === 0) {
    return { data };
  }
  const deployment = await activeDeployment(deps.db, environmentId, workflow);
  const included: NonNullable<WorkflowIncludeDocument['included']> = [];
  const { latestPublishedVersionId } = workflow;
  if (includes.includes('latest-published-version') && latestPublishedVersionId !== null) {
    const version = await requireWorkflowVersion(deps.db, environmentId, latestPublishedVersionId);
    included.push(workflowVersionResource(version, workflow, deployment));
  }
  if (includes.includes('active-deployment') && deployment !== null) {
    included.push(workflowDeploymentResource(deployment));
  }
  return { data, included };
}

export async function updateWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: UpdateWorkflowBody,
): Promise<WorkflowDocument> {
  const { environmentId } = acting.ctx;
  const { name, description } = body.data.attributes;
  const workflow = await change(deps, acting, async ({ tx, audit }) => {
    await requireLockedWorkflow(tx, environmentId, id);
    const row = await updateWorkflowRow(tx, environmentId, id, { name, description });
    await audit(
      workflowAudit('workflow.updated', id, {
        attributes: Object.keys(body.data.attributes) as ('name' | 'description')[],
      }),
    );
    return held(row);
  });
  return { data: workflowResource(workflow) };
}

export async function pauseWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowDocument> {
  const { environmentId } = acting.ctx;
  const workflow = await change(deps, acting, async ({ tx, emit, audit }) => {
    const current = await requireLockedWorkflow(tx, environmentId, id);
    if (current.status === 'paused') {
      return current;
    }
    const at = deps.clock.now();
    const row = await setWorkflowStatus(tx, environmentId, id, 'paused', 'operator', at);
    const data = workflowResource(held(row));
    await emit('workflow.paused', { data });
    await audit(workflowAudit('workflow.paused', id, { reason: 'operator' }));
    return held(row);
  });
  return { data: workflowResource(workflow) };
}

export async function activateWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowDocument> {
  const { environmentId } = acting.ctx;
  const workflow = await change(deps, acting, async ({ tx, audit }) => {
    const current = await requireLockedWorkflow(tx, environmentId, id);
    if (current.status === 'running') {
      return current;
    }
    if (current.latestPublishedVersionId === null) {
      throw new ConflictError('Publish a version before activating this workflow.');
    }
    if (current.pausedReason === 'publisher_revoked') {
      throw new ConflictError(
        'This workflow’s publisher lost a right it needs: a holder of the rights republishes it.',
      );
    }
    const row = await setWorkflowStatus(tx, environmentId, id, 'running', null, deps.clock.now());
    await audit(workflowAudit('workflow.activated', id, {}));
    return held(row);
  });
  return { data: workflowResource(workflow) };
}

/** C116.1, C118.3: an archive never touches a run, and leaves nothing that can start one. */
async function retireWorkflow(
  tx: Db,
  environmentId: string,
  workflow: WorkflowRow,
): Promise<number> {
  const { id } = workflow;
  await replaceWorkflowTriggers(tx, environmentId, id, []);
  await replaceWorkflowSchedule(tx, environmentId, id, null);
  for (const version of await listPublishedWorkflowVersions(tx, environmentId, id)) {
    await archiveWorkflowVersion(tx, environmentId, version.id);
  }
  if (workflow.activeDeploymentId !== null) {
    await setWorkflowDeploymentStatus(tx, environmentId, workflow.activeDeploymentId, 'inactive');
    await setWorkflowVersionPointers(tx, environmentId, id, { activeDeploymentId: null });
  }
  return cancelScheduledRunsForWorkflow(tx, environmentId, id);
}

export async function archiveWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowDocument> {
  const { environmentId } = acting.ctx;
  const workflow = await change(deps, acting, async ({ tx, audit }) => {
    const current = await requireLockedWorkflow(tx, environmentId, id);
    if (current.status !== 'paused') {
      throw new ConflictError('Pause this workflow before archiving it.');
    }
    const canceled = await retireWorkflow(tx, environmentId, current);
    const row = await setWorkflowStatus(tx, environmentId, id, 'archived', null, deps.clock.now());
    await audit(workflowAudit('workflow.archived', id, { 'canceled-scheduled-runs': canceled }));
    return held(row);
  });
  return { data: workflowResource(workflow) };
}

export async function getWorkflowDraft(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowVersionDocument> {
  const { environmentId } = acting.ctx;
  const workflow = await requireWorkflow(deps.db, environmentId, id);
  if (workflow.draftVersionId === null) {
    throw draftMissing();
  }
  const draft = await requireWorkflowVersion(deps.db, environmentId, workflow.draftVersionId);
  return versionDocument(deps.db, environmentId, workflow, draft);
}

export async function putWorkflowDraft(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: PutWorkflowDraftBody,
): Promise<WorkflowVersionDocument> {
  const { environmentId } = acting.ctx;
  const { definition, 'lock-version': lockVersion } = body.data.attributes;
  return change(deps, acting, async (work) => {
    const { tx } = work;
    const workflow = await requireLockedWorkflow(tx, environmentId, id);
    assertNoRollout(workflow);
    const { context } = await loadCheckContext(
      tx,
      environmentId,
      definition,
      workflow.kind,
      'draft',
    );
    const check = checkDefinition(definition, context);
    if (check.errors.length > 0) {
      throw definitionInvalid(check.errors);
    }
    const saved = await writeDraft(work, deps, acting, {
      workflow,
      definition,
      lockVersion,
      warnings: check.warnings,
    });
    return versionDocument(tx, environmentId, workflow, saved);
  });
}

export async function validateWorkflowDraft(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: ValidateWorkflowDraftBody | null,
): Promise<WorkflowDefinitionCheckDocument> {
  const { environmentId } = acting.ctx;
  const workflow = await requireWorkflow(deps.db, environmentId, id);
  const given = body?.data.attributes.definition;
  if (given === undefined && workflow.draftVersionId === null) {
    throw draftMissing();
  }
  const raw =
    given ??
    (await requireWorkflowVersion(deps.db, environmentId, held(workflow.draftVersionId)))
      .definition;
  const parsed = workflowDefinitionSchema.safeParse(raw);
  const { context } = await loadCheckContext(
    deps.db,
    environmentId,
    parsed.success ? parsed.data : EMPTY_DEFINITION,
    workflow.kind,
    'publish',
  );
  const { errors, warnings } = validateDefinition(raw, context);
  return { meta: { valid: errors.length === 0, errors: [...errors], warnings: [...warnings] } };
}

export async function listWorkflowVersions(
  deps: ApiDependencies,
  acting: WorkflowActing,
  query: ListWorkflowVersionsQuery,
): Promise<z.infer<typeof workflowVersionListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const workflowId = query['filter[workflow-id]'];
  const workflow = await requireWorkflow(deps.db, environmentId, workflowId);
  const page = await withCursor(() =>
    listVersionRows(deps.db, environmentId, workflowId, pageRequest(query)),
  );
  const deployment = await activeDeployment(deps.db, environmentId, workflow);
  return {
    data: page.items.map((row) => workflowVersionResource(row, workflow, deployment)),
    links: {
      next: nextLink(
        WORKFLOW_API_PATHS.versions,
        { 'filter[workflow-id]': workflowId },
        query,
        page.next,
      ),
    },
  };
}

export async function getWorkflowVersionDocument(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowVersionDocument> {
  const { environmentId } = acting.ctx;
  const version = await requireWorkflowVersion(deps.db, environmentId, id);
  const workflow = await requireWorkflow(deps.db, environmentId, version.workflowId);
  return versionDocument(deps.db, environmentId, workflow, version);
}

export async function getWorkflowVersionDiff(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  query: WorkflowVersionDiffQuery,
): Promise<WorkflowVersionDiffDocument> {
  const { environmentId } = acting.ctx;
  const version = await requireWorkflowVersion(deps.db, environmentId, id);
  const against = await requireWorkflowVersion(deps.db, environmentId, query.against);
  if (against.workflowId !== version.workflowId) {
    throw new NotFoundError(`Workflow version ${query.against} was not found.`);
  }
  return {
    data: {
      type: 'workflow-version-diff',
      id: idSchema('wfv').parse(id),
      attributes: {
        'against-version-id': idSchema('wfv').parse(query.against),
        ...diffDefinitions(readDefinition(version.definition), readDefinition(against.definition)),
      },
    },
  };
}
