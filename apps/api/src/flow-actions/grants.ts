/**
 * C152.2 (Workflow 9A; review F17): the authority a template's `run_workflow` steps need at publish:
 * the publisher holds `workflows:trigger`, every scope of each target version's grant and
 * `pii:view` when the grant has `pii`; a target with egress marks needs `egress:<step id>`
 * acknowledged; only workflows of the same environment. Owner: `api-flow-actions`; the call in the
 * publish path (`assertPublishable`, `services/inquiry-templates.ts`) was placed by `foundation-9a`
 * (Stage 1b (S)), with a contract test that publishing calls it.
 *
 * The publisher's permissions are read as Phase 8 reads a causing principal's
 * (`principalPermissions`): an API key by its scopes (a revoked or missing key holds none), a user
 * by its roles in the environment's organization; a workflow run publishing holds none (fail
 * closed). A v1 flow has no action step and asks nothing.
 */
import type { AuditActor } from '@openverify/contracts';
import { getEnvironment, type Db } from '@openverify/db';
import { isFlowV2, type AnyFlow } from '@openverify/flow-spec';
import { principalPermissions } from '../workflows/engine/authority.js';
import { resolveFlowRunTarget, type FlowRunTarget, type RunWorkflowAction } from './target.js';

/** What the grant check reads: the draft's flow and who publishes it. */
export interface FlowActionGrantContext {
  db: Db;
  environmentId: string;
  flow: AnyFlow;
  publisher: AuditActor;
}

/** One refused grant: a code, a JSON Pointer into the template attributes and what is wrong. */
export interface FlowActionGrantProblem {
  code: string;
  /** Such as `/flow/steps/4/action/workflowId`. */
  pointer: string;
  detail: string;
}

/** The `run_workflow` steps of a v2 flow, with their index in `steps`. */
function runSteps(flow: AnyFlow): { index: number; stepId: string; action: RunWorkflowAction }[] {
  if (!isFlowV2(flow)) {
    return [];
  }
  return flow.steps.flatMap((step, index) =>
    step.type === 'action' && step.action.kind === 'run_workflow'
      ? [{ index, stepId: step.id, action: step.action }]
      : [],
  );
}

/** What the publisher holds now; anything it cannot be read as holds nothing. */
async function publisherPermissions(
  db: Db,
  environmentId: string,
  publisher: AuditActor,
): Promise<ReadonlySet<string>> {
  if (publisher.type === 'workflow-run') {
    return new Set();
  }
  const environment = await getEnvironment(db, environmentId);
  return environment === null
    ? new Set()
    : principalPermissions(db, { environmentId }, environment.organizationId, publisher.id);
}

const REFUSALS = {
  workflow_not_found: {
    code: 'workflow_unknown',
    member: 'workflowId',
    detail: 'No workflow of this environment has this id.',
  },
  workflow_not_running: {
    code: 'workflow_unknown',
    member: 'workflowId',
    detail: 'No workflow of this environment has this id.',
  },
  workflow_not_published: {
    code: 'workflow_unpublished',
    member: 'version',
    detail: 'The workflow has no published version to run here.',
  },
  workflow_trigger_invalid: {
    code: 'workflow_trigger_invalid',
    member: 'workflowId',
    detail: 'The workflow’s version is not started by a flow (its trigger is not trigger-flow).',
  },
} as const;

/** The permissions a target's run needs of the publisher (C152.2), in the order a refusal names. */
const neededOf = (target: FlowRunTarget): string[] => [
  'workflows:trigger',
  ...target.grant.scopes,
  ...(target.grant.pii ? ['pii:view'] : []),
];

/** Every grant problem of the draft's `run_workflow` steps (C152.2). */
export async function flowActionGrantProblems(
  context: FlowActionGrantContext,
): Promise<FlowActionGrantProblem[]> {
  const steps = runSteps(context.flow);
  if (steps.length === 0) {
    return [];
  }
  const held = await publisherPermissions(context.db, context.environmentId, context.publisher);
  const problems: FlowActionGrantProblem[] = [];
  for (const { index, action } of steps) {
    const at = `/flow/steps/${String(index)}/action`;
    const target = await resolveFlowRunTarget(context.db, context.environmentId, action, {
      running: false,
    });
    if (typeof target === 'string') {
      const refusal = REFUSALS[target];
      problems.push({
        code: refusal.code,
        pointer: `${at}/${refusal.member}`,
        detail: refusal.detail,
      });
      continue;
    }
    const missing = neededOf(target).filter((permission) => !held.has(permission));
    if (missing.length > 0) {
      problems.push({
        code: 'workflow_grant_missing',
        pointer: `${at}/workflowId`,
        detail: `The publisher lacks what the workflow's runs need: ${missing.join(', ')}.`,
      });
    }
  }
  return problems;
}

/**
 * C152.2: one `run_workflow` step's recorded grant, the type of `inquiry_template_versions.
 * flow_run_grants` (Workflow 9B Stage 1a, (F): it lives in `@openverify/core` beside the column).
 */
export type { FlowRunGrantRecord } from '@openverify/core';
import type { FlowRunGrantRecord } from '@openverify/core';

/**
 * The records a publish stores for each `run_workflow` step whose target can run (C152.2), in step
 * order; a step refused by {@link flowActionGrantProblems} has none.
 */
export async function flowActionPublishGrants(
  context: Omit<FlowActionGrantContext, 'publisher'>,
): Promise<FlowRunGrantRecord[]> {
  const records: FlowRunGrantRecord[] = [];
  for (const { stepId, action } of runSteps(context.flow)) {
    const target = await resolveFlowRunTarget(context.db, context.environmentId, action, {
      running: false,
    });
    if (typeof target !== 'string') {
      records.push({
        stepId,
        workflowId: target.workflowId,
        workflowVersionId: target.versionId,
        scopes: [...target.grant.scopes],
        pii: target.grant.pii,
        egress: [...target.egress],
      });
    }
  }
  return records;
}

/**
 * C152.2: the acknowledgements the draft's `run_workflow` steps need (`egress:<step id>` for a
 * target with egress marks), for the publish path to require beside `analyzeFlowForPublish`'s.
 */
export async function flowActionAcknowledgements(
  context: Omit<FlowActionGrantContext, 'publisher'>,
): Promise<string[]> {
  const records = await flowActionPublishGrants(context);
  return records.filter(({ egress }) => egress.length > 0).map(({ stepId }) => `egress:${stepId}`);
}
