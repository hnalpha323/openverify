/**
 * C152.2, C152.7 (Workflow 9A; review H21, P07): `run_workflow`.
 *
 * **On entry**, in the transaction that enters the step, under the inquiry's lock: the target is a
 * workflow of this environment, running, whose resolved version (`latest-published` resolved now, or
 * the pinned `wfv_`) takes `trigger-flow`; its grant and egress must be no wider than the template's
 * publish allowed (C152.2 "checked again on entry"): a pinned version cannot change, so its grant is
 * the one the publish checked, and its egress needs the template's `egress:<step id>`
 * acknowledgement; a `latest-published` version is held to the grant the template version recorded
 * for the step at publish (`FlowRunGrantRecord`, read from the version's `flowRunGrants` member once
 * the column exists), and, with none recorded, to no scope at all, failing closed. Otherwise no run
 * starts and the entry takes `error` with `workflow_grant_widened`. The run starts through Phase 8's
 * run service (`startFlowRunInTx`): creator `inquiry-flow`, no causing principal, one per entry.
 *
 * **Waiting**: the session polls (every 2 s, C150.5) and `flow-action-sweep` settles: a completed run
 * takes `next` (its outputs are read from Phase 8's sealed run outputs by `flowWorkflowScopeInTx`,
 * never copied); an errored run takes `error` (`run_errored`), a canceled one `run_canceled`. Past the
 * timeout a still-running run is canceled through Phase 8's run cancellation, outside the inquiry's
 * lock (a run's step locks the run, then the inquiry, so the reverse would invert the order), and
 * the next settle takes `error` (`timeout`). A step already executing when the cancel lands
 * finishes; nothing it does after is read by the flow. Whichever commits first wins: a run that
 * completed before the cancel takes `next`.
 */
import {
  finishInquiryFlowActionInTx,
  getInquiryTemplateVersion,
  getWorkflowRun,
  insertInquiryFlowActionInTx,
  type Db,
  type Inquiry,
  type InquiryFlowAction,
} from '@openverify/db';
import { RUN_WORKFLOW_TIMEOUT } from '@openverify/flow-spec';
import { NotFoundError, WorkflowProblemError } from '../errors.js';
import type { FlowInquiryRef } from '../flow-engine/advance.js';
import { ulidIdGenerator } from '../ports.js';
import { appendSystemAuditEntry } from '../services/audit-log.js';
import { processActions } from '../workflows/engine/actions.js';
import type { EngineDeps } from '../workflows/engine/deps.js';
import { wakeStartedRun } from '../workflows/engine/start-run.js';
import { cancelRun } from '../workflows/runs/control.js';
import type { FlowRunGrantRecord } from './grants.js';
import { startFlowRunInTx } from './run.js';
import type { FlowActionDeps, FlowActionEntry, FlowActionOutcome } from './run-action.js';
import { resolveMapping } from './scope-values.js';
import { resolveFlowRunTarget, type FlowRunTarget, type RunWorkflowAction } from './target.js';

export type { RunWorkflowAction };

/** C150.5: the session polls a waiting position every 2 s. */
export const FLOW_RUN_POLL_MS = 2_000;

/** The `error-type` codes of a `run_workflow` entry (C152.2), in scope as `workflows.<id>.error-type`. */
export const RUN_WORKFLOW_ERROR_TYPES = [
  'workflow_not_found',
  'workflow_not_running',
  'workflow_not_published',
  'workflow_trigger_invalid',
  'workflow_grant_widened',
  'scope_unavailable',
  'run_errored',
  'run_canceled',
  'run_missing',
  'timeout',
] as const;
export type RunWorkflowErrorType = (typeof RUN_WORKFLOW_ERROR_TYPES)[number];

/** The engine as a flow action holds it: the caller's producers when it has them. */
export function flowEngineDepsOf(tx: Db, deps: FlowActionDeps): EngineDeps {
  return {
    // After the commit only the root database may be used; without one the sweeps take over.
    db: deps.db ?? tx,
    clock: deps.clock,
    ids: deps.ids ?? ulidIdGenerator,
    events: deps.events,
    steps: deps.db === undefined ? undefined : deps.workflowSteps,
    inFlightCap: deps.workflowInFlightCap,
    actions: processActions(),
  };
}

/** C152.2: the records a template version stored at publish, once its column exists. */
function recordedGrantOf(version: object, stepId: string): FlowRunGrantRecord | undefined {
  const records = 'flowRunGrants' in version ? version.flowRunGrants : undefined;
  if (!Array.isArray(records)) {
    return undefined;
  }
  return (records as FlowRunGrantRecord[]).find((record) => record.stepId === stepId);
}

const acknowledged = (version: { acknowledgements: readonly unknown[] }, key: string): boolean =>
  version.acknowledgements.some((entry) => (entry as { key?: unknown } | null)?.key === key);

/** C152.2 (P07): whether the resolved target is wider than the template's publish allowed. */
async function widened(
  tx: Db,
  inquiry: Inquiry,
  stepId: string,
  action: RunWorkflowAction,
  target: FlowRunTarget,
): Promise<boolean> {
  const version = await getInquiryTemplateVersion(
    tx,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    return true;
  }
  const recorded = recordedGrantOf(version, stepId);
  const pinned = action.version !== 'latest-published';
  // A pinned version is immutable: its grant is the one the publish checked.
  const allowed: { scopes: readonly string[]; pii: boolean } =
    pinned && recorded === undefined
      ? target.grant
      : { scopes: recorded?.scopes ?? [], pii: recorded?.pii ?? false };
  const scopesWider = target.grant.scopes.some((scope) => !allowed.scopes.includes(scope));
  const piiWider = target.grant.pii && !allowed.pii;
  const egressAllowed =
    target.egress.length === 0 ||
    (recorded === undefined
      ? acknowledged(version, `egress:${stepId}`)
      : target.egress.every((step) => recorded.egress.includes(step)));
  return scopesWider || piiWider || !egressAllowed;
}

const doneOf = (port: 'next' | 'error', errorType: string | null): FlowActionOutcome => ({
  state: 'done',
  port,
  errorType,
  staged: [],
});

/** Enters a `run_workflow` step: checks, starts the run and waits (C152.2). */
export async function enterRunWorkflowInTx(
  tx: Db,
  deps: FlowActionDeps,
  inquiry: Inquiry,
  entry: FlowActionEntry,
  action: RunWorkflowAction,
): Promise<FlowActionOutcome> {
  const { environmentId } = inquiry;
  const key = { inquiryId: inquiry.id, stepId: entry.stepId, entry: entry.entry };
  const now = deps.clock.now();
  const refuse = async (errorType: RunWorkflowErrorType) => {
    await insertInquiryFlowActionInTx(tx, environmentId, { ...key, enteredAt: now });
    await finishInquiryFlowActionInTx(tx, environmentId, key, {
      status: 'errored',
      errorType,
      finishedAt: now,
    });
    return doneOf('error', errorType);
  };
  const inputs = resolveMapping(action.inputs ?? {}, entry.scope);
  if (inputs === undefined) {
    return refuse('scope_unavailable');
  }
  const target = await resolveFlowRunTarget(tx, environmentId, action, { running: true });
  if (typeof target === 'string') {
    return refuse(target);
  }
  if (await widened(tx, inquiry, entry.stepId, action, target)) {
    return refuse('workflow_grant_widened');
  }
  const engine = flowEngineDepsOf(tx, deps);
  const started = await startFlowRunInTx(tx, engine, {
    environmentId,
    inquiryId: inquiry.id,
    stepId: entry.stepId,
    entry: entry.entry,
    workflowId: target.workflowId,
    workflowVersionId: target.versionId,
    inputs: Object.fromEntries(inputs),
    grant: target.grant,
  });
  const row = await insertInquiryFlowActionInTx(tx, environmentId, {
    ...key,
    workflowRunId: started.run.id,
    enteredAt: now,
  });
  const wake = () => wakeStartedRun(engine, started);
  // A run with no step to wait for ends in the transaction that starts it: settle it now.
  const settled =
    row === null
      ? null
      : await settleRunWorkflowInTx(
          tx,
          deps,
          { environmentId, inquiryId: inquiry.id },
          row,
          action,
        );
  return settled === null || settled.state === 'waiting'
    ? { state: 'waiting', retryAfterMs: FLOW_RUN_POLL_MS, staged: [], after: wake }
    : { ...settled, after: wake };
}

/** Cancels a timed-out run through Phase 8's cancellation, as the system; an ended run is left. */
export async function cancelTimedOutFlowRun(
  engine: EngineDeps,
  inquiry: FlowInquiryRef,
  row: Pick<InquiryFlowAction, 'stepId' | 'workflowRunId'>,
): Promise<void> {
  if (row.workflowRunId === null) {
    return;
  }
  try {
    await cancelRun(engine, inquiry.environmentId, row.workflowRunId, (tx, canceled) =>
      appendSystemAuditEntry(tx, inquiry.environmentId, {
        action: 'workflow-run.canceled',
        resourceType: 'workflow-run',
        resourceId: canceled.id,
        metadata: {
          'workflow-id': canceled.workflowId,
          reason: 'flow_action_timeout',
          'inquiry-id': inquiry.inquiryId,
          'flow-step-id': row.stepId,
        },
      }),
    );
  } catch (thrown) {
    // The run ended (or went) meanwhile: the next settle reads how.
    if (
      thrown instanceof NotFoundError ||
      (thrown instanceof WorkflowProblemError && thrown.code === 'run_not_cancelable')
    ) {
      return;
    }
    throw thrown;
  }
}

/** The entry's deadline: its entry plus its timeout (C152.2, 30 s by default). */
export const deadlineOf = (row: Pick<InquiryFlowAction, 'enteredAt'>, action: RunWorkflowAction) =>
  row.enteredAt.getTime() + (action.timeoutSeconds ?? RUN_WORKFLOW_TIMEOUT.default) * 1_000;

/** How a waiting `run_workflow` entry stands now; finishes its row when its run ended. */
export async function settleRunWorkflowInTx(
  tx: Db,
  deps: FlowActionDeps,
  inquiry: FlowInquiryRef,
  row: InquiryFlowAction,
  action: RunWorkflowAction,
): Promise<FlowActionOutcome> {
  const { environmentId } = inquiry;
  const key = { inquiryId: inquiry.inquiryId, stepId: row.stepId, entry: row.entry };
  const now = deps.clock.now();
  const finish = async (port: 'next' | 'error', errorType: RunWorkflowErrorType | null) => {
    await finishInquiryFlowActionInTx(tx, environmentId, key, {
      status: port === 'next' ? 'completed' : 'errored',
      errorType,
      finishedAt: now,
    });
    return doneOf(port, errorType);
  };
  const run =
    row.workflowRunId === null ? null : await getWorkflowRun(tx, environmentId, row.workflowRunId);
  if (run === null) {
    return finish('error', 'run_missing');
  }
  const deadline = deadlineOf(row, action);
  const timedOut = now.getTime() >= deadline;
  switch (run.status) {
    case 'completed':
      return finish('next', null);
    case 'errored':
      return finish('error', 'run_errored');
    case 'canceled':
      return finish('error', timedOut ? 'timeout' : 'run_canceled');
    case 'in_progress':
      break;
  }
  if (!timedOut) {
    return {
      state: 'waiting',
      retryAfterMs: Math.min(FLOW_RUN_POLL_MS, deadline - now.getTime()),
      staged: [],
    };
  }
  const root = deps.db;
  return {
    state: 'waiting',
    retryAfterMs: FLOW_RUN_POLL_MS,
    staged: [],
    cancelDue: true,
    after:
      root === undefined
        ? undefined
        : () => cancelTimedOutFlowRun(flowEngineDepsOf(root, deps), inquiry, row),
  };
}
