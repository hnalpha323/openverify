/**
 * C150.2, C152.2, C152.7 (Workflow 9A): the `workflows.<step id>` roots of the flow scope, read for
 * the engine's scope assembly (`api-flow-engine`) from the inquiry's action rows and Phase 8's
 * sealed run outputs, never copied: the latest entry of each `run_workflow` step, its `status`
 * (`completed`, `errored`, `canceled`, `timed-out`), its `error-type`, and its `outputs` only when
 * the run completed (a timed-out or errored workflow is never read as an output). A step still
 * waiting reads every member as `null`. Owner: `api-flow-actions`.
 */
import {
  getInquiry,
  getInquiryTemplateVersion,
  getWorkflowRun,
  listLatestInquiryFlowActions,
  openWorkflowRunValues,
  type Db,
  type InquiryFlowAction,
} from '@openverify/db';
import { isFlowV2, safeParseAnyFlow } from '@openverify/flow-spec';
import type { JsonValue } from '@openverify/workflow-engine';
import type { FlowInquiryRef } from '../flow-engine/advance.js';

/** One `run_workflow` step's facts in scope; `null` members read as unknown. */
export interface FlowWorkflowFacts {
  status: 'completed' | 'errored' | 'canceled' | 'timed-out' | null;
  'error-type': string | null;
  outputs: JsonValue | null;
}

function statusOf(row: InquiryFlowAction): FlowWorkflowFacts['status'] {
  switch (row.status) {
    case 'running':
      return null;
    case 'completed':
      return 'completed';
    case 'errored':
      return row.errorType === 'timeout'
        ? 'timed-out'
        : row.errorType === 'run_canceled'
          ? 'canceled'
          : 'errored';
  }
}

/** The `run_workflow` step ids of the inquiry's pinned flow (a v1 flow has none). */
async function runWorkflowStepsOf(tx: Db, inquiry: FlowInquiryRef): Promise<Set<string>> {
  const row = await getInquiry(tx, inquiry.environmentId, inquiry.inquiryId);
  const version =
    row === null
      ? null
      : await getInquiryTemplateVersion(tx, inquiry.environmentId, row.inquiryTemplateVersionId);
  const parsed = safeParseAnyFlow(version?.flow);
  if (!parsed.success || !isFlowV2(parsed.data)) {
    return new Set();
  }
  return new Set(
    parsed.data.steps.flatMap((step) =>
      step.type === 'action' && step.action.kind === 'run_workflow' ? [step.id] : [],
    ),
  );
}

/** The `workflows` root: one member per `run_workflow` step entered, by step id. */
export async function flowWorkflowScopeInTx(
  tx: Db,
  inquiry: FlowInquiryRef,
): Promise<Record<string, FlowWorkflowFacts>> {
  const steps = await runWorkflowStepsOf(tx, inquiry);
  const scope: Record<string, FlowWorkflowFacts> = {};
  for (const row of await listLatestInquiryFlowActions(
    tx,
    inquiry.environmentId,
    inquiry.inquiryId,
  )) {
    if (!steps.has(row.stepId)) {
      continue;
    }
    const status = statusOf(row);
    let outputs: JsonValue | null = null;
    if (status === 'completed' && row.workflowRunId !== null) {
      const run = await getWorkflowRun(tx, inquiry.environmentId, row.workflowRunId);
      // Purged values (C120.9 retention) or a redacted run read as unknown, never as an output.
      outputs =
        run === null ? null : ((openWorkflowRunValues(run).outputs as JsonValue | null) ?? null);
    }
    scope[row.stepId] = { status, 'error-type': row.errorType, outputs };
  }
  return scope;
}
