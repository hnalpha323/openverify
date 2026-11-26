/**
 * C151.2 (Workflow 9A, api-flow-engine): each exit of C151.2, applied to the current step only.
 *
 * | Exit | The current step | Port |
 * |---|---|---|
 * | consent recorded | a consent step | `next` |
 * | a verification decided | the verification step of its type | `next` when passed, skipped or in review; `exhausted` when it ended without passing and has the edge, else the inquiry fails; nothing while attempts are left |
 * | a screen submitted | that screen | the button's port |
 * | an action finished | that action, waiting | `next` or `error` |
 * | a snapshot written, a wait elapsed | that branch entry, waiting | the route the branch then takes |
 * | Phase 7's handoff continued here or redeemed | a `device_handoff` step | `next` |
 * | the phone's handoff declined | a `device_handoff` step | none: the step shows again |
 * | the redeemed phone rejected by the desktop | the step the phone is on | back to the handoff step |
 * | a client reported it cannot read a chip (Phase 10 C207.9) | an `nfc` step with an `exhausted` edge | `exhausted`, at once, as `clientUnableLeave` says; nothing without the edge |
 *
 * Anything else moves nothing: a client never moves the position except through the current
 * step's own exit (C151.12).
 */
import type { FlowExit } from './advance.js';
import type { InquiryFlowStep } from '@openverify/db';
import type { FlowV2Step } from '@openverify/flow-spec';
import {
  currentEntry,
  redeemedHandoffEntry,
  returnToHandoff,
  currentVerificationType,
  hasEdge,
  leaveEntry,
  leaveIfDecided,
  moveOn,
  resumeBranch,
  type EngineContext,
} from './engine.js';
import { clientUnableLeave } from '../services/client-unable.js';
import { isFlowVerification } from './verification-state.js';

export async function applyExit(ctx: EngineContext, exit: FlowExit): Promise<void> {
  const entry = currentEntry(ctx);
  const step = entry === null ? undefined : ctx.steps.get(entry.stepId);
  if (entry === null || step === undefined) {
    return;
  }
  const state = ctx.inquiry.flowState;
  switch (exit.kind) {
    case 'consent-recorded':
      if (state === 'active' && step.type === 'consent') {
        await leaveEntry(ctx, entry, 'next', 'recorded');
        await moveOn(ctx, step.id, 'next');
      }
      return;
    case 'verification-decided': {
      const verification = ctx.verifications.find((row) => row.id === exit.verificationId);
      if (
        state === 'active' &&
        verification !== undefined &&
        isFlowVerification(verification) &&
        currentVerificationType(ctx) === exit.verificationType
      ) {
        await leaveIfDecided(ctx, entry);
      }
      return;
    }
    case 'screen-submitted':
      if (state === 'active' && step.type === 'screen' && step.id === exit.stepId) {
        await leaveEntry(ctx, entry, exit.port, 'submitted', { sensitive: exit.port !== 'next' });
        await moveOn(ctx, step.id, exit.port);
      }
      return;
    case 'action-finished':
      if (state === 'waiting' && step.type === 'action' && step.id === exit.stepId) {
        await leaveEntry(ctx, entry, exit.port, exit.port === 'error' ? 'errored' : 'completed');
        await moveOn(ctx, step.id, exit.port);
      }
      return;
    case 'signal-snapshot-written':
    case 'wait-elapsed':
      if (state === 'waiting' && step.type === 'branch' && entry.seq === exit.stepRecordSeq) {
        await resumeBranch(ctx, entry, exit.kind === 'wait-elapsed');
      }
      return;
    case 'handoff-resolved':
      await resolveHandoff(ctx, entry, step, exit.resolution);
      return;
    case 'client-unable': {
      // C207.9 (Workflow 10C, contracts-10c's hook): how the step is left is api-nfc's rule
      // (`services/client-unable.ts`); the engine only walks the port it names.
      if (state !== 'active' || step.type !== 'nfc') {
        return;
      }
      const hasExhaustedEdge = hasEdge(ctx, step.id, 'exhausted');
      const leave = clientUnableLeave({
        stepId: step.id,
        onFallback: (step as { onFallback?: string }).onFallback ?? null,
        hasExhaustedEdge,
        acknowledgements: ctx.pinned.version.acknowledgements,
        reason: exit.reason,
        platform: exit.platform,
      });
      if (leave === null || !hasExhaustedEdge) {
        return;
      }
      await leaveEntry(ctx, entry, leave.port, leave.outcome, { notes: leave.notes });
      await moveOn(ctx, step.id, leave.port);
      return;
    }
  }
}

/**
 * C96.1, C96.3 (Phase 7) on the server's position: continuing here or a phone's redemption leaves
 * the handoff step through `next` (the phone goes on with the flow); a decline leaves the step
 * where it is, so it shows again; a rejection of a redeemed phone takes the position back to the
 * handoff step, while the flow is still taking input there.
 */
async function resolveHandoff(
  ctx: EngineContext,
  entry: InquiryFlowStep,
  step: FlowV2Step,
  resolution: 'continued-here' | 'redeemed' | 'rejected' | 'declined',
): Promise<void> {
  if (ctx.inquiry.flowState !== 'active') {
    return;
  }
  if (resolution === 'continued-here' || resolution === 'redeemed') {
    if (step.type === 'device_handoff') {
      await leaveEntry(ctx, entry, 'next', resolution);
      await moveOn(ctx, step.id, 'next');
    }
    return;
  }
  if (resolution === 'rejected' && step.type !== 'device_handoff') {
    const handoff = redeemedHandoffEntry(ctx.record);
    if (handoff !== null) {
      await returnToHandoff(ctx, handoff.stepId);
    }
  }
}
