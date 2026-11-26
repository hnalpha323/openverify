/**
 * C120: the run routes' service. Run values are masked fail closed by the registry's marks (C120.6);
 * a resume stops at an `unknown` effect until it is acknowledged, audited (C120.3); a redaction of one
 * run is an admin's (P35); `POST /workflows/:id/test-runs` is sandbox-only (C120.7).
 */
import {
  WORKFLOW_RUN_INCLUDE_PERMISSIONS,
  buildWorkflowRunResource,
  buildWorkflowRunStepResource,
  filterValues,
  idSchema,
  workflowRunIncludeSchema,
  type CancelWorkflowRunsBody,
  type ResumeWorkflowRunBody,
  type WorkflowRunDocument,
  type WorkflowRunIncludeDocument,
  type WorkflowRunResource,
  type cancelWorkflowRunsDocumentSchema,
  type createWorkflowTestRunBodySchema,
  type getWorkflowRunQuerySchema,
  type listWorkflowRunStepsQuerySchema,
  type listWorkflowRunsQuerySchema,
  type workflowActionListDocumentSchema,
  type workflowRunListDocumentSchema,
  type workflowRunStepListDocumentSchema,
} from '@openverify/contracts';
import { workflowRunStatusSchema, type Permission } from '@openverify/core';
import {
  forgetStoredResponses,
  getWorkflow,
  getWorkflowRun,
  getWorkflowVersion,
  listWorkflowRunEffects,
  listWorkflowRunFiles,
  listWorkflowRunSteps as listSteps,
  listWorkflowRunSubjectIds,
  listWorkflowRuns as listRuns,
  lockWorkflowRun,
  openValue,
  openWorkflowRunValues,
  openWorkflowStepValues,
  stubEventPayloads,
  SEALED,
  type Db,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from '@openverify/db';
import { z } from 'zod';
import { buildWorkflowRunFileResource } from './resources.js';
import { canViewPii } from '../../auth/pii.js';
import { NotFoundError } from '../../errors.js';
import { authorizePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import { auditEntryOf } from '../../services/context.js';
import { nextLink, pageRequest, withCursor } from '../../services/pagination.js';
import type { WorkflowActing } from '../acting.js';
import {
  activeDeployment,
  workflowResource,
  workflowVersionResource,
} from '../definitions/resources.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { processActions } from '../engine/actions.js';
import type { EngineDeps } from '../engine/deps.js';
import { runRecordOf } from '../engine/run-events.js';
import { definitionOf, variablesOf } from '../engine/run-frame.js';
import { actionCatalogue } from './catalogue.js';
import { cancelRun, cancelRunsBeforeVersion, rerunRun, resumeRun } from './control.js';
import {
  maskInputs,
  maskOutputs,
  maskStepOutput,
  maskTriggerSnapshot,
  maskVariables,
} from './masking.js';
import { caseIdsIn, filterCaseVisibility } from '../../services/cases/visibility.js';
import { redactRunInTx } from './redaction.js';
import { startTestRun } from './test-runs.js';

const notFound = (): NotFoundError => new NotFoundError('Workflow run not found.');

export const engineOf = (deps: ApiDependencies): EngineDeps => ({
  db: deps.db,
  clock: deps.clock,
  ids: deps.ids,
  events: deps.events,
  steps: deps.workflowSteps,
  inFlightCap: deps.workflowInFlightCap,
  queueInFlightCapMax: deps.queueInFlightCapMax,
  actions: processActions(),
});

/** The run as this reader may see it (C120.6). */
function resourceOf(
  run: WorkflowRunRow,
  subjectIds: readonly string[],
  definition: Awaited<ReturnType<typeof definitionOf>>,
  visible: boolean,
): WorkflowRunResource {
  const values = openWorkflowRunValues(run);
  const variables = variablesOf(values.variables);
  const seen = {
    inputs: values.inputs,
    variables,
    outputs: values.outputs,
    triggerSnapshot: values.triggerSnapshot,
  };
  const masked = {
    inputs: values.inputs === null ? null : maskInputs(values.inputs, definition),
    variables: variables === null ? null : maskVariables(variables, definition),
    outputs: values.outputs === null ? null : maskOutputs(values.outputs, definition),
    triggerSnapshot:
      values.triggerSnapshot === null ? null : maskTriggerSnapshot(values.triggerSnapshot),
  };
  return buildWorkflowRunResource({
    ...runRecordOf(run, subjectIds, definition),
    ...(visible ? seen : masked),
  });
}

/** A run's resource, its values seen when `visible`; also the access export's (C253.2). */
export async function resourceFor(
  db: Db,
  run: WorkflowRunRow,
  visible: boolean,
): Promise<WorkflowRunResource> {
  const subjects = await listWorkflowRunSubjectIds(db, run.environmentId, [run.id]);
  const definition = await definitionOf(db, run.environmentId, run.workflowVersionId);
  return resourceOf(run, subjects.get(run.id) ?? [], definition, visible);
}

async function requireRun(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowRunRow> {
  const run = await getWorkflowRun(deps.db, acting.ctx.environmentId, id);
  if (run === null) {
    throw notFound();
  }
  // C129.4 (V08; Workflow 8B): a run whose subjects include a case the reader may not see reads as
  // missing, behind every run route.
  const subjects = await listWorkflowRunSubjectIds(deps.db, run.environmentId, [run.id]);
  const [visible] = await filterCaseVisibility(
    deps.db,
    { environmentId: run.environmentId, principal: acting.principal },
    [run],
    (row) => caseIdsIn(...(subjects.get(row.id) ?? [])),
  );
  if (visible === undefined) {
    throw notFound();
  }
  return visible;
}

export async function listWorkflowRuns(
  deps: ApiDependencies,
  acting: WorkflowActing,
  query: z.infer<typeof listWorkflowRunsQuerySchema>,
): Promise<z.infer<typeof workflowRunListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const subject = query['filter[subject-id]'];
  const page = await withCursor(() =>
    listRuns(
      deps.db,
      environmentId,
      {
        workflowIds: filterValues(query['filter[workflow-id]'], idSchema('wfl')),
        statuses: filterValues(query['filter[status]'], workflowRunStatusSchema),
        workflowVersionIds: filterValues(query['filter[workflow-version-id]'], idSchema('wfv')),
        subjectIds: subject === undefined ? undefined : [subject],
        hasStepErrors:
          query['filter[has-step-errors]'] === undefined
            ? undefined
            : query['filter[has-step-errors]'] === 'true',
      },
      pageRequest(query),
    ),
  );
  const subjects = await listWorkflowRunSubjectIds(
    deps.db,
    environmentId,
    page.items.map(({ id }) => id),
  );
  // C129.4 (V08; Workflow 8B): a page can come back short, and `links.next` still moves on.
  const shown = await filterCaseVisibility(
    deps.db,
    { environmentId, principal: acting.principal },
    page.items,
    (run) => caseIdsIn(...(subjects.get(run.id) ?? [])),
  );
  const visible = canViewPii(acting.principal);
  const data = await Promise.all(
    shown.map(async (run) =>
      resourceOf(
        run,
        subjects.get(run.id) ?? [],
        await definitionOf(deps.db, environmentId, run.workflowVersionId),
        visible,
      ),
    ),
  );
  return {
    data,
    links: {
      next: nextLink(
        '/api/v1/workflow-runs',
        {
          'filter[workflow-id]': query['filter[workflow-id]']?.toString(),
          'filter[status]': query['filter[status]']?.toString(),
          'filter[workflow-version-id]': query['filter[workflow-version-id]']?.toString(),
          'filter[subject-id]': subject,
          'filter[has-step-errors]': query['filter[has-step-errors]']?.toString(),
        },
        query,
        page.next,
      ),
    },
  };
}

export async function getWorkflowRunDocument(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  query: z.infer<typeof getWorkflowRunQuerySchema>,
): Promise<WorkflowRunIncludeDocument> {
  const includes = filterValues(query.include, workflowRunIncludeSchema) ?? [];
  for (const include of includes) {
    authorizePrincipal(acting.principal, [
      ...WORKFLOW_RUN_INCLUDE_PERMISSIONS[include],
    ] as Permission[]);
  }
  const { environmentId } = acting.ctx;
  const run = await requireRun(deps, acting, id);
  const data = await resourceFor(deps.db, run, canViewPii(acting.principal));
  if (includes.length === 0) {
    return { data };
  }
  const workflow = await getWorkflow(deps.db, environmentId, run.workflowId);
  if (workflow === null) {
    throw notFound();
  }
  const included: NonNullable<WorkflowRunIncludeDocument['included']> = [];
  if (includes.includes('workflow')) {
    included.push(workflowResource(workflow));
  }
  if (includes.includes('workflow-version')) {
    const version = await getWorkflowVersion(deps.db, environmentId, run.workflowVersionId);
    if (version !== null) {
      const deployment = await activeDeployment(deps.db, environmentId, workflow);
      included.push(workflowVersionResource(version, workflow, deployment));
    }
  }
  return { data, included };
}

/** C120.7, C123.4: a test run's console is shown only to whoever started it. */
const ownsConsole = (run: WorkflowRunRow, acting: WorkflowActing): boolean =>
  run.isTestRun && run.creatorId === acting.actor.id;

function stepResource(
  step: WorkflowRunStepRow,
  run: WorkflowRunRow,
  acting: WorkflowActing,
  effectStatus: 'claimed' | 'done' | 'unknown' | null,
) {
  const visible = canViewPii(acting.principal);
  const values = openWorkflowStepValues(step);
  const output = values.output;
  return buildWorkflowRunStepResource({
    id: step.id,
    nodeId: step.nodeId,
    iterationPath: step.iterationPath,
    nodeType: step.nodeType,
    actionKey: step.actionKey,
    actionVersion: step.actionVersion,
    status: step.status,
    attempt: step.attempt,
    dueAt: step.dueAt,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    errorType: step.errorType,
    errorCode: step.errorCode,
    effectStatus,
    simulated: step.simulated,
    overridden: step.overridden,
    input: visible ? values.input : null,
    output: visible || output === null ? output : maskStepOutput(step, output, WORKFLOW_ACTIONS),
    console: visible && ownsConsole(run, acting) ? values.console : null,
  });
}

export async function listWorkflowRunSteps(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  query: z.infer<typeof listWorkflowRunStepsQuerySchema>,
): Promise<z.infer<typeof workflowRunStepListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const run = await requireRun(deps, acting, id);
  const page = await withCursor(() => listSteps(deps.db, environmentId, id, pageRequest(query)));
  const effects = new Map(
    (await listWorkflowRunEffects(deps.db, environmentId, id)).map(({ stepId, status }) => [
      stepId,
      status,
    ]),
  );
  const visible = canViewPii(acting.principal);
  const files = await listWorkflowRunFiles(deps.db, environmentId, id);
  const included = files.map((file) =>
    buildWorkflowRunFileResource({
      id: file.id,
      filename:
        visible && file.filenameSealed !== null
          ? openValue(SEALED.workflowRunFileFilename, file.id, file.filenameSealed)
          : null,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      createdAt: file.createdAt,
    }),
  );
  return {
    data: page.items.map((step) => stepResource(step, run, acting, effects.get(step.id) ?? null)),
    ...(included.length === 0 ? {} : { included }),
    links: { next: nextLink(`/api/v1/workflow-runs/${id}/steps`, {}, query, page.next) },
  };
}

const RUN_AUDIT_METADATA = {
  'workflow-run.canceled': z.strictObject({ 'workflow-id': z.string() }),
  'workflow-run.resumed': z.strictObject({
    'workflow-id': z.string(),
    'acknowledged-unknown-effects': z.int().min(0),
  }),
  'workflow-run.reran': z.strictObject({
    'workflow-id': z.string(),
    'rerun-of': z.string(),
  }),
  'workflow-run.redacted': z.strictObject({ 'workflow-id': z.string() }),
} as const;

async function recordRun<Action extends keyof typeof RUN_AUDIT_METADATA>(
  deps: ApiDependencies,
  acting: WorkflowActing,
  tx: Db,
  action: Action,
  run: WorkflowRunRow,
  metadata: z.input<(typeof RUN_AUDIT_METADATA)[Action]>,
): Promise<void> {
  await deps.audit.record(
    tx,
    auditEntryOf(acting.ctx, acting.actor, {
      action,
      resourceType: 'workflow-run',
      resourceId: run.id,
      metadata: RUN_AUDIT_METADATA[action].parse(metadata),
    }),
  );
}

export async function resumeWorkflowRun(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: ResumeWorkflowRunBody | null,
): Promise<WorkflowRunDocument> {
  const run = await resumeRun(engineOf(deps), acting.ctx.environmentId, id, {
    skipUnknownEffects: body?.meta?.['skip-unknown-effects'] === true,
    audit: (tx, resumed, acknowledged) =>
      recordRun(deps, acting, tx, 'workflow-run.resumed', resumed, {
        'workflow-id': resumed.workflowId,
        'acknowledged-unknown-effects': acknowledged.length,
      }),
  });
  return { data: await resourceFor(deps.db, run, canViewPii(acting.principal)) };
}

export async function rerunWorkflowRun(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowRunDocument> {
  const run = await rerunRun(engineOf(deps), acting, id, (tx, started) =>
    recordRun(deps, acting, tx, 'workflow-run.reran', started, {
      'workflow-id': started.workflowId,
      'rerun-of': id,
    }),
  );
  return { data: await resourceFor(deps.db, run, canViewPii(acting.principal)) };
}

export async function cancelWorkflowRun(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowRunDocument> {
  const run = await cancelRun(engineOf(deps), acting.ctx.environmentId, id, (tx, canceled) =>
    recordRun(deps, acting, tx, 'workflow-run.canceled', canceled, {
      'workflow-id': canceled.workflowId,
    }),
  );
  return { data: await resourceFor(deps.db, run, canViewPii(acting.principal)) };
}

export async function cancelWorkflowRuns(
  deps: ApiDependencies,
  acting: WorkflowActing,
  workflowId: string,
  body: CancelWorkflowRunsBody,
): Promise<z.infer<typeof cancelWorkflowRunsDocumentSchema>> {
  const canceled = await cancelRunsBeforeVersion(
    engineOf(deps),
    acting.ctx.environmentId,
    workflowId,
    body.meta['before-version-id'],
    (tx, run) =>
      recordRun(deps, acting, tx, 'workflow-run.canceled', run, {
        'workflow-id': run.workflowId,
      }),
  );
  return { meta: { 'canceled-count': canceled } };
}

/** C120.9 (P35): one run's sealed columns go, and its files lose their key. */
export async function redactWorkflowRun(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<WorkflowRunDocument> {
  const { environmentId } = acting.ctx;
  const run = await deps.db.transaction(async (tx) => {
    const found = await lockWorkflowRun(tx, environmentId, id);
    if (found === null) {
      throw notFound();
    }
    const at = deps.clock.now();
    await redactRunInTx(tx, found, at);
    await stubEventPayloads(tx, environmentId, [id], at);
    await forgetStoredResponses(tx, environmentId, [id]);
    await recordRun(deps, acting, tx, 'workflow-run.redacted', found, {
      'workflow-id': found.workflowId,
    });
    return lockWorkflowRun(tx, environmentId, id);
  });
  if (run === null) {
    throw notFound();
  }
  return { data: await resourceFor(deps.db, run, canViewPii(acting.principal)) };
}

export async function createWorkflowTestRun(
  deps: ApiDependencies,
  acting: WorkflowActing,
  workflowId: string,
  body: z.infer<typeof createWorkflowTestRunBodySchema>,
): Promise<WorkflowRunDocument> {
  const run = await startTestRun(engineOf(deps), acting, workflowId, body);
  return { data: await resourceFor(deps.db, run, canViewPii(acting.principal)) };
}

export const listWorkflowActions = (
  deps: ApiDependencies,
  acting: WorkflowActing,
): Promise<z.infer<typeof workflowActionListDocumentSchema>> =>
  Promise.resolve(actionCatalogue(deps, acting));
