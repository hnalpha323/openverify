/** What the workflow routes share: the lookups, the problems and the draft's one write. */
import type { WorkflowDefinition, WorkflowVersionDocument } from '@openverify/contracts';
import {
  createWorkflowDraft,
  getWorkflow,
  getWorkflowVersion,
  lockWorkflow,
  nextWorkflowVersionNumber,
  saveWorkflowDraft,
  setWorkflowVersionPointers,
  type Db,
  type WorkflowRow,
  type WorkflowVersionRow,
} from '@openverify/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  WorkflowProblemError,
} from '../../errors.js';
import type { UserPrincipal } from '../../ports.js';
import type { ApiDependencies } from '../../services/context.js';
import type { TransactionChange } from '../../services/transactions/shared.js';
import type { WorkflowActing } from '../acting.js';
import { workflowAudit } from './audit.js';
import { activeDeployment, workflowVersionResource } from './resources.js';

/**
 * A row this transaction wrote or locked a moment ago.
 * @throws {Error} for `null`, which the workflow's row lock rules out.
 */
export function held<T>(row: T | null): T {
  if (row === null) {
    throw new Error('A row held by this transaction is gone');
  }
  return row;
}

/**
 * C121.2: publish, rollout, restore and promote are user-only.
 * @throws {ForbiddenError} for an API key.
 */
export function requireUser({ principal }: WorkflowActing): UserPrincipal {
  if (principal.kind !== 'user') {
    throw new ForbiddenError('A person publishes a workflow: an API key cannot.');
  }
  return principal;
}

/** @throws {NotFoundError} for a workflow this environment does not hold. */
export async function requireWorkflow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRow> {
  const workflow = await getWorkflow(db, environmentId, id);
  if (workflow === null) {
    throw new NotFoundError(`Workflow ${id} was not found.`);
  }
  return workflow;
}

/** The workflow's row, locked: every change of a workflow's versions holds it (C116.1). */
export async function requireLockedWorkflow(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRow> {
  const workflow = await lockWorkflow(tx, environmentId, id);
  if (workflow === null) {
    throw new NotFoundError(`Workflow ${id} was not found.`);
  }
  if (workflow.status === 'archived') {
    throw new ConflictError('An archived workflow does not change.');
  }
  return workflow;
}

/** @throws {NotFoundError} for a version this environment does not hold. */
export async function requireWorkflowVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowVersionRow> {
  const version = await getWorkflowVersion(db, environmentId, id);
  if (version === null) {
    throw new NotFoundError(`Workflow version ${id} was not found.`);
  }
  return version;
}

/** C113.6: pointers and codes, and text that never echoes a value. */
export function definitionInvalid(
  issues: readonly { pointer: string; code: string; detail: string }[],
): WorkflowProblemError {
  return new WorkflowProblemError(
    'definition_invalid',
    'The definition breaks a rule of the workflow format at each place below.',
    { errors: issues.map((issue) => ({ location: 'definition', ...issue })) },
  );
}

/** C116.3: editing is locked until a rollout is finished or undone. */
export function assertNoRollout(workflow: WorkflowRow): void {
  if (workflow.activeDeploymentId !== null) {
    throw new WorkflowProblemError(
      'rollout_in_progress',
      'Finish or undo the rollout before changing this workflow.',
    );
  }
}

export function draftMissing(): WorkflowProblemError {
  return new WorkflowProblemError('draft_missing', 'This workflow has no draft.');
}

/** A version's resource, with what its workflow says about it. */
export async function versionDocument(
  db: Db,
  environmentId: string,
  workflow: WorkflowRow,
  version: WorkflowVersionRow,
): Promise<WorkflowVersionDocument> {
  const deployment = await activeDeployment(db, environmentId, workflow);
  return { data: workflowVersionResource(version, workflow, deployment) };
}

function versionLocked(): WorkflowProblemError {
  return new WorkflowProblemError(
    'version_locked',
    'The draft changed since this lock-version was read.',
  );
}

export interface DraftSave {
  workflow: WorkflowRow;
  definition: WorkflowDefinition;
  lockVersion: number;
  warnings: readonly unknown[];
}

/** C116.1: the draft, or a new one at `lock-version: 0` when none is open. */
export async function writeDraft(
  { tx, audit }: TransactionChange,
  deps: ApiDependencies,
  acting: WorkflowActing,
  { workflow, definition, lockVersion, warnings }: DraftSave,
): Promise<WorkflowVersionRow> {
  const { environmentId } = acting.ctx;
  let draftId = workflow.draftVersionId;
  let expected = lockVersion;
  if (draftId === null) {
    if (lockVersion !== 0) {
      throw versionLocked();
    }
    draftId = deps.ids.newId('wfv');
    await createWorkflowDraft(tx, environmentId, {
      id: draftId,
      workflowId: workflow.id,
      versionNumber: await nextWorkflowVersionNumber(tx, environmentId, workflow.id),
      schemaVersion: definition['schema-version'],
      definition,
      lastUpdater: acting.actor.id,
    });
    await setWorkflowVersionPointers(tx, environmentId, workflow.id, { draftVersionId: draftId });
    expected = 1;
  }
  const saved = await saveWorkflowDraft(tx, environmentId, draftId, expected, {
    definition,
    schemaVersion: definition['schema-version'],
    triggerType: definition.trigger?.type ?? null,
    triggerConfig: definition.trigger?.config ?? null,
    warnings,
    lastUpdater: acting.actor.id,
  });
  if (saved === null) {
    throw versionLocked();
  }
  await audit(
    workflowAudit('workflow-version.updated', saved.id, {
      'workflow-id': workflow.id,
      'lock-version': saved.lockVersion,
    }),
  );
  return saved;
}
