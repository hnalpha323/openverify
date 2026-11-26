/**
 * C116, C121: publishing. Everything happens in one transaction under the workflow's row lock: the
 * graph, typing, null and taint rules, the C116.4 rules, the grant against the publisher, the
 * acknowledgements, then the freeze, the trigger and wait indexes, and the events.
 *
 * A problem in one family hides the next, in the order a person fixes them: the definition, the
 * secrets it names, what the publisher holds, what the publisher must acknowledge, the fan-out.
 */
import type {
  PublishWorkflowBody,
  WorkflowAcknowledgement,
  WorkflowDefinition,
  WorkflowEgressMark,
  WorkflowGrant,
  WorkflowVersionDocument,
} from '@openverify/contracts';
import { missingPermissions } from '@openverify/core';
import {
  archiveWorkflowVersion,
  countWorkflowsListeningToEvent,
  createWorkflowDeployment,
  getWorkflow,
  getWorkflowVersion,
  listPublishedWorkflowVersions,
  listPublishedWorkflowVersionsCalling,
  publishWorkflowVersion,
  recordWorkflowWaitIndex,
  replaceWorkflowSchedule,
  replaceWorkflowTriggers,
  setWorkflowStatus,
  setWorkflowVersionPointers,
  type Db,
  type WorkflowRow,
  type WorkflowVersionRow,
} from '@openverify/db';
import {
  WORKFLOW_RUN_LIMITS,
  analyzeAdverseSteps,
  checkDefinition,
  definitionSha256,
  readDefinition,
  type DefinitionCheck,
  type DefinitionIssue,
} from '@openverify/workflow-engine';
import { WorkflowProblemError } from '../../errors.js';
import type { ApiDependencies } from '../../services/context.js';
import { change, type TransactionChange } from '../../services/transactions/shared.js';
import type { WorkflowActing } from '../acting.js';
import { workflowAudit } from '../definitions/audit.js';
import { loadCheckContext } from '../definitions/context.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { workflowResource, workflowVersionResource } from '../definitions/resources.js';
import {
  assertNoRollout,
  definitionInvalid,
  draftMissing,
  held,
  requireLockedWorkflow,
  requireUser,
  requireWorkflowVersion,
  versionDocument,
} from '../definitions/shared.js';
import { loadPublishFacts } from './facts.js';
import { deriveGrant, publisherRequirements } from './grant.js';
import { scheduleOf, triggerIndexRows, waitEventNames, type TriggerTarget } from './index-rows.js';
import { evaluatePublishRules, type PublishRuleReport } from './rules.js';

const FULL_ROLLOUT = 100;

/** C121.3: the published grants of the workflows this version starts, at this publish. */
export async function childGrants(
  db: Db,
  environmentId: string,
  definition: WorkflowDefinition,
): Promise<{ grants: WorkflowGrant[]; warnings: DefinitionIssue[] }> {
  const grants: WorkflowGrant[] = [];
  const warnings: DefinitionIssue[] = [];
  for (const [index, step] of definition.steps.entries()) {
    const isChild =
      step.type === 'action' &&
      (step['action-key'] === 'run_workflow' || step['action-key'] === 'schedule_workflow');
    const target = isChild ? step.config['workflow-id'] : undefined;
    if (typeof target === 'string' && !target.includes('{{')) {
      const workflow = await getWorkflow(db, environmentId, target);
      const versionId = workflow?.latestPublishedVersionId ?? null;
      const version =
        versionId === null ? null : await getWorkflowVersion(db, environmentId, versionId);
      if (version === null) {
        warnings.push({
          pointer: `/steps/${String(index)}/config/workflow-id`,
          code: 'child_workflow_unpublished',
          detail: 'This workflow has no published version, so a run of this step errors.',
        });
      } else {
        grants.push(version.grant as WorkflowGrant);
      }
    }
  }
  return { grants, warnings };
}

/** C121.3: this publish widens a target that published parents start. */
async function wideningWarnings(
  db: Db,
  environmentId: string,
  workflowId: string,
  grant: WorkflowGrant,
): Promise<DefinitionIssue[]> {
  const parents = await listPublishedWorkflowVersionsCalling(db, environmentId, workflowId);
  const widened = parents.some(({ grant: stored }) => {
    const held = stored as WorkflowGrant;
    return (grant.pii && !held.pii) || grant.scopes.some((scope) => !held.scopes.includes(scope));
  });
  return widened
    ? [
        {
          pointer: '',
          code: 'child_grant_widened',
          detail: 'A published workflow starts this one on a narrower grant, so those runs error.',
        },
      ]
    : [];
}

async function assertFanout(
  db: Db,
  environmentId: string,
  workflowId: string,
  definition: WorkflowDefinition,
): Promise<void> {
  const { trigger } = definition;
  if (trigger?.type !== 'trigger-event' && trigger?.type !== 'trigger-verification') {
    return;
  }
  const limit = WORKFLOW_RUN_LIMITS['event-fanout'].value;
  const errors = [];
  for (const [index, name] of trigger.config.events.entries()) {
    const others = await countWorkflowsListeningToEvent(db, environmentId, name, workflowId);
    if (others >= limit) {
      errors.push({
        location: 'definition',
        pointer: `/trigger/config/events/${String(index)}`,
        detail: `${String(limit)} published workflows already listen to this event.`,
      });
    }
  }
  if (errors.length > 0) {
    throw new WorkflowProblemError(
      'publish_trigger_fanout_exceeded',
      'An event starts at most 50 workflows.',
      { errors },
    );
  }
}

function assertSecrets(report: PublishRuleReport): void {
  const problem = (
    code: 'secret_reference_invalid' | 'secret_value_missing',
    detail: string,
    issues: readonly DefinitionIssue[],
  ) => {
    if (issues.length > 0) {
      throw new WorkflowProblemError(code, detail, {
        errors: issues.map((issue) => ({ location: 'definition', ...issue })),
      });
    }
  };
  problem(
    'secret_reference_invalid',
    'A step names a secret that does not exist.',
    report.secretsUnknown,
  );
  problem(
    'secret_value_missing',
    'A step names a secret with no value in this environment.',
    report.secretsWithoutValue,
  );
}

/** C116.4: the acknowledgements as stored, or a problem naming what is missing. */
function acknowledgementsOf(
  report: PublishRuleReport,
  given: readonly string[],
  userId: string,
  at: string,
): WorkflowAcknowledgement[] {
  const held = new Set(given);
  const required = [...new Set(report.acknowledgements.map(({ key }) => key))];
  const missing = required.filter((key) => !held.has(key));
  if (missing.length > 0) {
    throw new WorkflowProblemError(
      'publish_acknowledgement_missing',
      'A step needs an acknowledgement this publish does not carry.',
      {
        errors: missing.map((detail) => ({
          location: 'body',
          pointer: '/meta/acknowledgements',
          detail,
        })),
      },
    );
  }
  return required.map((key) => ({ key, 'acknowledged-by': userId, 'acknowledged-at': at }));
}

/** C116.3: what a staged rollout refuses, each at the body's own member. */
function assertRollout(
  workflow: WorkflowRow,
  definition: WorkflowDefinition,
  control: WorkflowDefinition | null,
): void {
  const refuse = (code: string, detail: string) => {
    throw definitionInvalid([{ pointer: '/meta/rollout-percentage', code, detail }]);
  };
  if (workflow.kind === 'module') {
    refuse('rollout_refused_for_module', 'A module has no staged rollout.');
  }
  if (control === null) {
    refuse('rollout_without_control', 'A first publish has no version to split with.');
  } else if (JSON.stringify(control.trigger) !== JSON.stringify(definition.trigger)) {
    refuse('rollout_trigger_changed', 'A staged rollout keeps the trigger of its control.');
  }
}

/** C116.1, C118.4: what starts a run of this version, rebuilt in the publish transaction. */
export async function rebuildIndexes(
  tx: Db,
  deps: ApiDependencies,
  environmentId: string,
  workflowId: string,
  definition: WorkflowDefinition,
  target: TriggerTarget,
): Promise<void> {
  await replaceWorkflowTriggers(
    tx,
    environmentId,
    workflowId,
    triggerIndexRows(definition, target),
  );
  await replaceWorkflowSchedule(
    tx,
    environmentId,
    workflowId,
    scheduleOf(definition, { id: deps.ids.newId('wfsc'), workflowId, now: deps.clock.now() }),
  );
}

interface Publication {
  workflow: WorkflowRow;
  draft: WorkflowVersionRow;
  definition: WorkflowDefinition;
  percentage: number;
  grant: WorkflowGrant;
  check: DefinitionCheck;
  acknowledgements: readonly WorkflowAcknowledgement[];
  warnings: readonly DefinitionIssue[];
  description: string | null;
  userId: string;
}

const egressMarks = (check: DefinitionCheck): WorkflowEgressMark[] =>
  check.egress.map(({ stepId, paths, destination }) => ({
    'step-id': stepId,
    paths: [...paths],
    destination,
  }));

/** The freeze, the pointers, the indexes and the events. */
async function freeze(
  { tx, emit, audit }: TransactionChange,
  deps: ApiDependencies,
  environmentId: string,
  publication: Publication,
  control: WorkflowVersionRow | null,
): Promise<{ workflow: WorkflowRow; version: WorkflowVersionRow }> {
  const { workflow, draft, definition, percentage, grant, check, userId } = publication;
  const staged = percentage < FULL_ROLLOUT;
  const version = held(
    await publishWorkflowVersion(tx, environmentId, draft.id, {
      definitionSha256: definitionSha256(definition),
      grant,
      egress: egressMarks(check),
      acknowledgements: publication.acknowledgements,
      warnings: publication.warnings,
      description: publication.description,
      publishedAt: deps.clock.now(),
      publishedById: userId,
    }),
  );
  await recordWorkflowWaitIndex(tx, environmentId, version.id, waitEventNames(definition));

  let deployment = null;
  if (staged && control !== null) {
    deployment = await createWorkflowDeployment(tx, environmentId, {
      id: deps.ids.newId('wfd'),
      workflowId: workflow.id,
      versions: [
        { token: version.id, percentage, label: 'treatment' },
        { token: control.id, percentage: FULL_ROLLOUT - percentage, label: 'control' },
      ],
    });
    await replaceWorkflowTriggers(
      tx,
      environmentId,
      workflow.id,
      triggerIndexRows(definition, { deploymentId: deployment.id }),
    );
  } else {
    for (const previous of await listPublishedWorkflowVersions(tx, environmentId, workflow.id)) {
      if (previous.id !== version.id) {
        await archiveWorkflowVersion(tx, environmentId, previous.id);
      }
    }
    await rebuildIndexes(tx, deps, environmentId, workflow.id, definition, {
      versionId: version.id,
    });
  }
  await setWorkflowVersionPointers(tx, environmentId, workflow.id, {
    draftVersionId: null,
    ...(deployment === null
      ? { latestPublishedVersionId: version.id }
      : { activeDeploymentId: deployment.id }),
  });
  // C121.5: paused until a holder of the rights republishes, and this publish is that.
  const updated =
    workflow.pausedReason === 'publisher_revoked'
      ? await setWorkflowStatus(tx, environmentId, workflow.id, 'running', null, deps.clock.now())
      : await getWorkflow(tx, environmentId, workflow.id);
  const row = held(updated);

  await emit('workflow-version.published', {
    data: workflowVersionResource(version, row, deployment, { withDefinition: false }),
  });
  await audit(
    workflowAudit('workflow-version.published', version.id, {
      'workflow-id': workflow.id,
      'version-number': version.versionNumber,
      'definition-sha256': held(version.definitionSha256),
      'rollout-percentage': percentage,
      'rollout-label': staged ? 'treatment' : null,
      scopes: [...grant.scopes],
      pii: grant.pii,
      acknowledgements: publication.acknowledgements.map(({ key }) => key),
      'egress-step-ids': check.egress.map(({ stepId }) => stepId),
    }),
  );
  if (!staged) {
    await emit('workflow.published', { data: workflowResource(row) });
    await audit(
      workflowAudit('workflow.published', workflow.id, { 'workflow-version-id': version.id }),
    );
  }
  return { workflow: row, version };
}

export async function publishWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: PublishWorkflowBody | null,
): Promise<WorkflowVersionDocument> {
  const user = requireUser(acting);
  const { environmentId } = acting.ctx;
  const meta = body?.meta ?? {};
  const percentage = meta['rollout-percentage'] ?? FULL_ROLLOUT;
  return change(deps, acting, async (work) => {
    const { tx } = work;
    const workflow = await requireLockedWorkflow(tx, environmentId, id);
    assertNoRollout(workflow);
    if (workflow.draftVersionId === null) {
      throw draftMissing();
    }
    const draft = await requireWorkflowVersion(tx, environmentId, workflow.draftVersionId);
    const definition = readDefinition(draft.definition);
    const controlId = workflow.latestPublishedVersionId;
    const control =
      controlId === null ? null : await getWorkflowVersion(tx, environmentId, controlId);
    if (percentage < FULL_ROLLOUT) {
      assertRollout(
        workflow,
        definition,
        control === null ? null : readDefinition(control.definition),
      );
    }

    const { context, moduleGrants } = await loadCheckContext(
      tx,
      environmentId,
      definition,
      workflow.kind,
      'publish',
    );
    const check = checkDefinition(definition, context);
    if (check.errors.length > 0) {
      throw definitionInvalid(check.errors);
    }
    const { facts, templateIsBiometric } = await loadPublishFacts(deps, tx, acting, definition);
    const report = evaluatePublishRules({
      definition,
      analyses: analyzeAdverseSteps(definition, {
        registry: WORKFLOW_ACTIONS,
        templateIsBiometric,
      }),
      egress: check.egress,
      registry: WORKFLOW_ACTIONS,
      facts,
    });
    if (report.errors.length > 0) {
      throw definitionInvalid(report.errors);
    }
    assertSecrets(report);

    const children = await childGrants(tx, environmentId, definition);
    const grant = deriveGrant(definition, {
      registry: WORKFLOW_ACTIONS,
      egress: check.egress.length > 0,
      nested: [...moduleGrants, ...children.grants],
    });
    const missing = missingPermissions(
      user.permissions,
      publisherRequirements(grant, facts.environmentKind),
    );
    if (missing.length > 0) {
      throw new WorkflowProblemError(
        'publish_grant_missing',
        'The publisher lacks a scope the version needs.',
        { members: { 'missing-scopes': missing } },
      );
    }
    const at = deps.clock.now().toISOString();
    const acknowledgements = acknowledgementsOf(
      report,
      meta.acknowledgements ?? [],
      user.userId,
      at,
    );
    await assertFanout(tx, environmentId, workflow.id, definition);

    const widening = await wideningWarnings(tx, environmentId, workflow.id, grant);
    const published = await freeze(
      work,
      deps,
      environmentId,
      {
        workflow,
        draft,
        definition,
        percentage,
        grant,
        check,
        acknowledgements,
        warnings: [...check.warnings, ...report.warnings, ...children.warnings, ...widening],
        description: meta.description ?? null,
        userId: user.userId,
      },
      control,
    );
    return versionDocument(tx, environmentId, published.workflow, published.version);
  });
}
