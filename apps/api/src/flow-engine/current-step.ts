/**
 * C151.4 (Workflow 9A): only the current step accepts input. Owner: `api-flow-engine`; the
 * signature and every call site were placed by `foundation-9a` (Stage 1b (S)): consent, creating
 * or reusing a verification, an upload and a submission (`services/flow.ts`), and the handoff routes
 * (`services/handoff/flow-handoffs.ts`). Each call runs inside the caller's transaction, after the
 * inquiry's row lock. A screen submission (`routes/flow/screens.ts`) is the owner's own call.
 *
 * It throws the 409 `flow_step_not_current` (no detail of another path) when the request is not for
 * the step the position names, or when the position is not taking input (waiting, halted, ended).
 */
import type { VerificationType } from '@openverify/core';
import { getInquiry, listInquiryFlowSteps, type Db } from '@openverify/db';
import type { FlowV2Step } from '@openverify/flow-spec';
import type { FlowInquiryRef } from './advance.js';
import { redeemedHandoffEntry, resolvedHandoffEntry } from './engine.js';
import { pinnedFlowOf } from './pinned-flow.js';
import { flowStepNotCurrent } from './problems.js';
import { stepVerificationType } from './verification-state.js';

/** What a flow request is about to do, for the step it names. */
export type FlowStepAttempt =
  | { kind: 'consent'; stepId: string | null }
  | { kind: 'verification'; stepId: string; verificationType: VerificationType }
  | { kind: 'upload'; verificationId: string; verificationType: VerificationType }
  | { kind: 'submission'; verificationId: string; verificationType: VerificationType }
  | { kind: 'screen'; stepId: string }
  | {
      kind: 'handoff';
      action: 'issue' | 'continue-here' | 'redeem' | 'reject' | 'decline';
    };

/** Whether `attempt` is for `step`, the step the position names. */
function isFor(step: FlowV2Step, attempt: FlowStepAttempt): boolean {
  switch (attempt.kind) {
    case 'consent':
      return step.type === 'consent';
    case 'verification':
    case 'upload':
    case 'submission':
      return stepVerificationType(step) === attempt.verificationType;
    case 'screen':
      return step.type === 'screen' && step.id === attempt.stepId;
    case 'handoff':
      return step.type === 'device_handoff';
  }
}

/**
 * Refuses `attempt` unless it is for the current step (C151.4) with 409 `flow_step_not_current`,
 * one body whatever was asked, naming no other step. An inquiry the engine never positioned keeps
 * today's rules (its settlement still requires every verification step of the flow); the session
 * read, a consent, a screen or a handoff positions it (C151.14).
 */
export async function assertCurrentStepInTx(
  tx: Db,
  inquiry: FlowInquiryRef,
  attempt: FlowStepAttempt,
): Promise<void> {
  const row = await getInquiry(tx, inquiry.environmentId, inquiry.inquiryId);
  if (row?.flowStepId == null) {
    return;
  }
  const pinned = await pinnedFlowOf(tx, row);
  const step = pinned?.flow.steps.find((candidate) => candidate.id === row.flowStepId);
  if (step !== undefined && row.flowState === 'active' && isFor(step, attempt)) {
    return;
  }
  if (attempt.kind === 'handoff') {
    const record = await listInquiryFlowSteps(tx, inquiry.environmentId, inquiry.inquiryId);
    if (attempt.action === 'reject' && row.flowState === 'active') {
      if (redeemedHandoffEntry(record) !== null) {
        // C96.3 (Phase 7): the desktop may reject the phone that redeemed its handoff while the
        // phone works on the steps after it; the rejection takes the position back (`exits.ts`).
        return;
      }
    } else if (resolvedHandoffEntry(record) !== null) {
      // C96.3: once the path left the handoff step through a resolution, Phase 7's own state of
      // that step answers a late issue, redemption, decline or continue-here (it refuses each with
      // its own code), so a race keeps the answers of Phase 7 and nothing moves.
      return;
    }
  }
  if (attempt.kind === 'consent' && (await consentStepPassed(tx, inquiry))) {
    // C94.6 (Phase 7): a session that holds no consent of its own (a phone a handoff redeemed)
    // records its own once the flow has passed its consent step; that moves nothing (the advance
    // finds no consent step current), so it is not a step's input.
    return;
  }
  throw flowStepNotCurrent();
}

/** Whether the step record holds a consent step the path left. */
async function consentStepPassed(tx: Db, inquiry: FlowInquiryRef): Promise<boolean> {
  return (await listInquiryFlowSteps(tx, inquiry.environmentId, inquiry.inquiryId)).some(
    (entry) => entry.stepType === 'consent' && entry.exitPort !== null,
  );
}
