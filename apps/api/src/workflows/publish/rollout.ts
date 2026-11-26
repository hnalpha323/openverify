/**
 * C116.3, C116.5: a rollout's percentage, 100 to finish and 0 to undo, and restore, which only ever
 * makes a draft, so a restore passes every publish rule. Each is user-only (C121.2) and refuses a
 * user who could not publish what it puts live.
 */
import type {
  RestoreWorkflowBody,
  RolloutWorkflowBody,
  WorkflowGrant,
  WorkflowVersionDocument,
} from '@openverify/contracts';
import { missingPermissions } from '@openverify/core';
import {
  archiveWorkflowVersion,
  setWorkflowDeploymentStatus,
  setWorkflowDeploymentVersions,
  setWorkflowVersionPointers,
  type WorkflowDeploymentRow,
  type WorkflowRow,
  type WorkflowVersionRow,
} from '@openverify/db';
import { readDefinition } from '@openverify/workflow-engine';
import { ConflictError, NotFoundError, WorkflowProblemError } from '../../errors.js';
import type { UserPrincipal } from '../../ports.js';
import type { ApiDependencies } from '../../services/context.js';
import { change, type TransactionChange } from '../../services/transactions/shared.js';
import type { WorkflowActing } from '../acting.js';
import { workflowAudit } from '../definitions/audit.js';
import {
  activeDeployment,
  deploymentVersions,
  workflowResource,
} from '../definitions/resources.js';
import {
  assertNoRollout,
  held,
  requireLockedWorkflow,
  requireUser,
  requireWorkflowVersion,
  versionDocument,
  writeDraft,
} from '../definitions/shared.js';
import { publisherRequirements } from './grant.js';
import { rebuildIndexes } from './publish.js';

interface Sides {
  deployment: WorkflowDeploymentRow;
  treatment: WorkflowVersionRow;
  control: WorkflowVersionRow;
}

async function sidesOf(
  work: TransactionChange,
  environmentId: string,
  workflow: WorkflowRow,
): Promise<Sides> {
  const deployment = await activeDeployment(work.tx, environmentId, workflow);
  if (deployment === null) {
    throw new ConflictError('This workflow has no rollout in progress.');
  }
  const sides = deploymentVersions(deployment);
  const side = (label: string) => sides.find((version) => version.label === label)?.token ?? '';
  return {
    deployment,
    treatment: await requireWorkflowVersion(work.tx, environmentId, side('treatment')),
    control: await requireWorkflowVersion(work.tx, environmentId, side('control')),
  };
}

function assertMayPutLive(
  user: UserPrincipal,
  grant: WorkflowGrant,
  environmentKind: WorkflowActing['environmentKind'],
): void {
  const missing = missingPermissions(
    user.permissions,
    publisherRequirements(grant, environmentKind),
  );
  if (missing.length > 0) {
    throw new WorkflowProblemError(
      'publish_grant_missing',
      'The publisher lacks a scope the version needs.',
      { members: { 'missing-scopes': missing } },
    );
  }
}

/** C116.3: the treatment serves everyone, and `workflow.published` says so (C116.7). */
async function finish(
  work: TransactionChange,
  deps: ApiDependencies,
  environmentId: string,
  workflow: WorkflowRow,
  { deployment, treatment, control }: Sides,
): Promise<WorkflowRow> {
  const { tx, emit, audit } = work;
  await setWorkflowDeploymentStatus(tx, environmentId, deployment.id, 'inactive');
  await archiveWorkflowVersion(tx, environmentId, control.id);
  await rebuildIndexes(tx, deps, environmentId, workflow.id, readDefinition(treatment.definition), {
    versionId: treatment.id,
  });
  const row = held(
    await setWorkflowVersionPointers(tx, environmentId, workflow.id, {
      latestPublishedVersionId: treatment.id,
      activeDeploymentId: null,
    }),
  );
  await emit('workflow.published', { data: workflowResource(row) });
  await audit(
    workflowAudit('workflow.published', workflow.id, { 'workflow-version-id': treatment.id }),
  );
  return row;
}

/** C116.3: the control serves everyone again, and the treatment's runs stay as they are. */
async function undo(
  work: TransactionChange,
  deps: ApiDependencies,
  environmentId: string,
  workflow: WorkflowRow,
  { deployment, treatment, control }: Sides,
): Promise<WorkflowRow> {
  const { tx } = work;
  await setWorkflowDeploymentStatus(tx, environmentId, deployment.id, 'inactive');
  await archiveWorkflowVersion(tx, environmentId, treatment.id);
  await rebuildIndexes(tx, deps, environmentId, workflow.id, readDefinition(control.definition), {
    versionId: control.id,
  });
  return held(
    await setWorkflowVersionPointers(tx, environmentId, workflow.id, {
      activeDeploymentId: null,
    }),
  );
}

export async function rolloutWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: RolloutWorkflowBody,
): Promise<WorkflowVersionDocument> {
  const user = requireUser(acting);
  const { environmentId } = acting.ctx;
  const percentage = body.meta['rollout-percentage'];
  return change(deps, acting, async (work) => {
    const { tx, audit } = work;
    const workflow = await requireLockedWorkflow(tx, environmentId, id);
    const sides = await sidesOf(work, environmentId, workflow);
    const { deployment, treatment } = sides;
    assertMayPutLive(user, treatment.grant as WorkflowGrant, acting.environmentKind);
    let updated = workflow;
    if (percentage === 100) {
      updated = await finish(work, deps, environmentId, workflow, sides);
    } else if (percentage === 0) {
      updated = await undo(work, deps, environmentId, workflow, sides);
    } else {
      await setWorkflowDeploymentVersions(
        tx,
        environmentId,
        deployment.id,
        deploymentVersions(deployment).map((side) => ({
          ...side,
          percentage: side.label === 'treatment' ? percentage : 100 - percentage,
        })),
      );
    }
    await audit(
      workflowAudit('workflow-version.rollout-updated', treatment.id, {
        'workflow-id': workflow.id,
        'workflow-version-id': treatment.id,
        'rollout-percentage': percentage,
      }),
    );
    const version = await requireWorkflowVersion(tx, environmentId, treatment.id);
    return versionDocument(tx, environmentId, updated, version);
  });
}

export async function restoreWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: RestoreWorkflowBody,
): Promise<WorkflowVersionDocument> {
  requireUser(acting);
  const { environmentId } = acting.ctx;
  const restored = body.meta['version-id'];
  return change(deps, acting, async (work) => {
    const { tx, audit } = work;
    const workflow = await requireLockedWorkflow(tx, environmentId, id);
    assertNoRollout(workflow);
    if (workflow.draftVersionId !== null) {
      throw new WorkflowProblemError('draft_exists', 'This workflow already has a draft.');
    }
    const version = await requireWorkflowVersion(tx, environmentId, restored);
    if (version.workflowId !== workflow.id) {
      throw new NotFoundError(`Workflow version ${restored} was not found.`);
    }
    const draft = await writeDraft(work, deps, acting, {
      workflow,
      definition: readDefinition(version.definition),
      lockVersion: 0,
      warnings: [],
    });
    await audit(
      workflowAudit('workflow-version.restored', draft.id, {
        'workflow-id': workflow.id,
        'restored-from': restored,
      }),
    );
    const updated = await requireLockedWorkflow(tx, environmentId, id);
    return versionDocument(tx, environmentId, updated, draft);
  });
}
