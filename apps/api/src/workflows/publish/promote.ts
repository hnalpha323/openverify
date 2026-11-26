/**
 * C112.2: a promote copies a published version into another environment of the organisation as a
 * draft, never a replacement, and never publishes it. Each reference is re-resolved there by the
 * object's name: none or several refuse the promote, by pointer into the definition, and no name or
 * object of the target reaches the answer. Only a user who may work in both environments promotes.
 */
import type {
  PromoteWorkflowBody,
  WorkflowDefinition,
  WorkflowVersionDocument,
} from '@openverify/contracts';
import { missingPermissions, type Permission } from '@openverify/core';
import {
  WORKFLOW_REFERENCE_KINDS,
  createWorkflow as createWorkflowRow,
  createWorkflowDraft,
  findWorkflowReferences,
  getEnvironment,
  listWorkflowsNamed,
  lockWorkflow,
  readWorkflowReferences,
  setWorkflowVersionPointers,
  nextWorkflowVersionNumber,
  saveWorkflowDraft,
  type Db,
  type WorkflowRow,
} from '@openverify/db';
import { checkDefinition, readDefinition } from '@openverify/workflow-engine';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  WorkflowProblemError,
} from '../../errors.js';
import { auditEntryOf, type ApiDependencies } from '../../services/context.js';
import { change } from '../../services/transactions/shared.js';
import type { WorkflowActing } from '../acting.js';
import { workflowAudit } from '../definitions/audit.js';
import { loadCheckContext } from '../definitions/context.js';
import {
  assertNoRollout,
  definitionInvalid,
  held,
  requireUser,
  requireWorkflow,
  requireWorkflowVersion,
  versionDocument,
} from '../definitions/shared.js';
import { referencesIn, replaceReferences, type DefinitionReference } from './references.js';
import { userPermissionsInEnvironment } from '../../services/access/permissions.js';

function promoteUnresolved(pointers: readonly string[]): WorkflowProblemError {
  return new WorkflowProblemError(
    'promote_unresolved',
    'A reference has no single match in the target environment.',
    {
      errors: pointers.map((pointer) => ({
        location: 'definition',
        pointer,
        code: 'reference_unresolved',
        detail: 'No object of that name, or several.',
      })),
    },
  );
}

/** Each reference's id in the target, keyed by its id here; every unresolved one is refused. */
async function resolveReferences(
  db: Db,
  sourceEnvironmentId: string,
  targetEnvironmentId: string,
  references: readonly DefinitionReference[],
  known: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const replacements = new Map(known);
  const unresolved: string[] = [];
  for (const kind of WORKFLOW_REFERENCE_KINDS) {
    const ofKind = references.filter((reference) => reference.kind === kind);
    const rows = await readWorkflowReferences(
      db,
      sourceEnvironmentId,
      kind,
      ofKind.map(({ id }) => id),
    );
    const names = new Map(rows.map(({ id, name }) => [id, name]));
    for (const { id, pointer } of ofKind) {
      if (!replacements.has(id)) {
        const name = names.get(id);
        const matches =
          name === undefined
            ? []
            : await findWorkflowReferences(db, targetEnvironmentId, kind, name);
        const [match] = matches;
        if (match === undefined || matches.length > 1) {
          unresolved.push(pointer);
        } else {
          replacements.set(id, match.id);
        }
      }
    }
  }
  if (unresolved.length > 0) {
    throw promoteUnresolved(unresolved);
  }
  return replacements;
}

/** The workflow a promote lands in: the one of that name and kind, or a new one. */
async function targetWorkflow(
  tx: Db,
  environmentId: string,
  source: WorkflowRow,
  id: string,
): Promise<WorkflowRow | null> {
  const named = (await listWorkflowsNamed(tx, environmentId, source.name, source.kind)).filter(
    ({ status }) => status !== 'archived',
  );
  const [found] = named;
  if (named.length > 1) {
    throw promoteUnresolved(['']);
  }
  if (found === undefined) {
    await createWorkflowRow(tx, environmentId, {
      id,
      name: source.name,
      description: source.description,
      kind: source.kind,
    });
    return lockWorkflow(tx, environmentId, id);
  }
  return lockWorkflow(tx, environmentId, found.id);
}

export async function promoteWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: PromoteWorkflowBody,
): Promise<WorkflowVersionDocument> {
  const user = requireUser(acting);
  const sourceEnvironmentId = acting.ctx.environmentId;
  const targetEnvironmentId = body.meta['environment-id'];
  const target = await getEnvironment(deps.db, targetEnvironmentId);
  if (target?.organizationId !== acting.ctx.organizationId) {
    throw new NotFoundError(`Environment ${targetEnvironmentId} was not found.`);
  }
  if (targetEnvironmentId === sourceEnvironmentId) {
    throw new ConflictError('A workflow is promoted into another environment.');
  }
  const production = target.kind === 'production' || acting.environmentKind === 'production';
  const required: readonly Permission[] = [
    'workflows:write',
    ...(production ? (['environments:production'] as const) : []),
  ];
  // C167.2 (Workflow 9B Stage 1b (U)): the rights in the target too, where the user's assignments
  // may differ (`api-access`'s hook).
  const targetPermissions = await userPermissionsInEnvironment(deps.db, user, targetEnvironmentId);
  if (
    missingPermissions(user.permissions, required).length > 0 ||
    missingPermissions(targetPermissions, required).length > 0
  ) {
    throw new ForbiddenError('A promote needs the rights in both environments.');
  }

  return change(deps, acting, async ({ tx, audit }) => {
    const source = await requireWorkflow(tx, sourceEnvironmentId, id);
    assertNoRollout(source);
    if (source.latestPublishedVersionId === null) {
      throw new WorkflowProblemError('draft_missing', 'This workflow has no published version.');
    }
    const version = await requireWorkflowVersion(
      tx,
      sourceEnvironmentId,
      source.latestPublishedVersionId,
    );
    const definition = readDefinition(version.definition);
    const newId = deps.ids.newId('wfl');
    const landing = await targetWorkflow(tx, targetEnvironmentId, source, newId);
    const workflow = held(landing);
    assertNoRollout(workflow);
    if (workflow.draftVersionId !== null) {
      throw new WorkflowProblemError(
        'draft_exists',
        'The target workflow already has a draft, and a promote never replaces one.',
      );
    }
    const replacements = await resolveReferences(
      tx,
      sourceEnvironmentId,
      targetEnvironmentId,
      referencesIn(definition),
      new Map([[source.id, workflow.id]]),
    );
    const promoted: WorkflowDefinition = replaceReferences(definition, replacements);
    const { context } = await loadCheckContext(
      tx,
      targetEnvironmentId,
      promoted,
      workflow.kind,
      'draft',
    );
    const check = checkDefinition(promoted, context);
    if (check.errors.length > 0) {
      throw definitionInvalid(check.errors);
    }
    const draftId = deps.ids.newId('wfv');
    await createWorkflowDraft(tx, targetEnvironmentId, {
      id: draftId,
      workflowId: workflow.id,
      versionNumber: await nextWorkflowVersionNumber(tx, targetEnvironmentId, workflow.id),
      schemaVersion: promoted['schema-version'],
      definition: promoted,
      lastUpdater: user.userId,
      promotedFrom: version.id,
    });
    const draft = await saveWorkflowDraft(tx, targetEnvironmentId, draftId, 1, {
      definition: promoted,
      schemaVersion: promoted['schema-version'],
      triggerType: promoted.trigger?.type ?? null,
      triggerConfig: promoted.trigger?.config ?? null,
      warnings: check.warnings,
      lastUpdater: user.userId,
    });
    const updated = held(
      await setWorkflowVersionPointers(tx, targetEnvironmentId, workflow.id, {
        draftVersionId: draftId,
      }),
    );
    const entry = workflowAudit('workflow-version.promoted', draftId, {
      'workflow-id': workflow.id,
      'promoted-from': version.id,
      'source-environment-id': sourceEnvironmentId,
      'target-environment-id': targetEnvironmentId,
    });
    await audit(entry);
    await deps.audit.record(
      tx,
      auditEntryOf({ ...acting.ctx, environmentId: targetEnvironmentId }, acting.actor, entry),
    );
    return versionDocument(tx, targetEnvironmentId, updated, held(draft));
  });
}
