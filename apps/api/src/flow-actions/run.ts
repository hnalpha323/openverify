/**
 * C152.2 (Workflow 9A; C120.1 amended): a flow's `run_workflow` starts its run through Phase 8's run
 * service, in the transaction that enters the action step, with the trigger type `trigger-flow`, the
 * creator `inquiry-flow` named by the inquiry's id, and no causing principal (the end user's flow,
 * C121.3): the run acts on the frozen grant it is given. One run per `(inquiry, step, entry)`: a
 * repeated call answers the run the first made. Plumbing by `foundation-9a` (Stage 1b (S)); owner
 * `api-flow-actions`, which resolves the version (`latest-published` on entry), checks the grant
 * against the one stored at publish (`workflow_grant_widened`), and waits on the run's
 * `workflow-run.*` events.
 */
import type { JsonRecord } from '@openverify/workflow-engine';
import type { Db } from '@openverify/db';
import type { RunGrant } from '../workflows/engine/action-port.js';
import type { EngineDeps } from '../workflows/engine/deps.js';
import { startWorkflowRunInTx, type StartedWorkflowRun } from '../workflows/engine/start-run.js';

/** The run a flow action starts. */
export interface StartFlowRunInput {
  environmentId: string;
  inquiryId: string;
  /** The action step and its entry, which key the run (one per entry). */
  stepId: string;
  entry: number;
  workflowId: string;
  /** The version resolved on entry. */
  workflowVersionId: string;
  /** The declared inputs, the run's whole trigger view (C152.2: never the inquiry's data). */
  inputs: JsonRecord;
  /** The target version's grant, checked against the one stored at publish. */
  grant: RunGrant;
}

/** The idempotency key of a flow's run: one run per inquiry, action step and entry. */
export const flowRunKeyOf = (input: Pick<StartFlowRunInput, 'inquiryId' | 'stepId' | 'entry'>) =>
  `inquiry-flow:${input.inquiryId}:${input.stepId}:${String(input.entry)}`;

/** Starts (or finds) the entry's run; run the answer's `after` once the transaction commits. */
export function startFlowRunInTx(
  tx: Db,
  deps: EngineDeps,
  input: StartFlowRunInput,
): Promise<StartedWorkflowRun> {
  return startWorkflowRunInTx(tx, deps, {
    environmentId: input.environmentId,
    workflowId: input.workflowId,
    workflowVersionId: input.workflowVersionId,
    triggerType: 'trigger-flow',
    idempotencyKey: flowRunKeyOf(input),
    creator: { type: 'inquiry-flow', id: input.inquiryId },
    trigger: input.inputs,
    inputs: input.inputs,
    subjectIds: [input.inquiryId],
    causedByPrincipal: null,
    grant: input.grant,
  });
}
