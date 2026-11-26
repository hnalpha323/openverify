/**
 * C151.2 (Workflow 9A): `advanceFlowInTx`, the server flow engine's one entry. Owner:
 * `api-flow-engine`; the signature and every call site were placed by `foundation-9a` (Stage 1b (S)).
 *
 * Each exit of the current step advances in the transaction that records it, under the inquiry's
 * row lock, so no reader ever sees a finished step as current. The callers (each a shared file):
 * - a verification decided: `processVerification`'s decision transaction and
 *   `failVerificationAfterError`'s (`jobs/process-verification.ts`), and the silent AAMVA attempt
 *   inside the government ID's decision hook (`jobs/types/aamva.ts`); Phase 8's sandbox
 *   `run_verification` with `debug-forced-status` calls it with `origin: 'workflow-action'`, which
 *   decides a verification created outside the flow and is never the current step's attempt
 *   (C151.4), so the engine leaves the position where it is;
 * - consent recorded (`services/flow.ts`, `recordConsent`);
 * - Phase 7's handoff resolved (`services/handoff/flow-handoffs.ts`: continue here, redeem,
 *   reject, decline);
 * - a screen submitted, an action finished, a signal snapshot written, a wait elapsed: the owners'
 *   own code (`routes/flow/screens.ts`, `flow-actions/`, `jobs/flow/signal-snapshot.ts`);
 * - a client reported that it cannot read a document chip (Phase 10 C207.9;
 *   `services/client-unable.ts`, `api-nfc`).
 *
 * The engine itself is `engine.ts`; each exit's rule is `exits.ts`; where the position starts is
 * `position.ts`.
 */
import { applyExit } from './exits.js';
import { advanceOf, loadEngine } from './engine.js';
import { ensurePosition } from './position.js';
import type { ClientUnablePlatform, ClientUnableReason } from '@openverify/contracts';
import type { VerificationStatus, VerificationType } from '@openverify/core';
import type { Db } from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import type { Clock, FlowSignalSnapshotQueue } from '../ports.js';

/** The inquiry whose position moves; the caller holds its row lock. */
export interface FlowInquiryRef {
  environmentId: string;
  inquiryId: string;
}

/** What the engine needs from its caller's dependencies. */
export interface AdvanceFlowDeps {
  events: TransactionalEventPublisher;
  clock: Clock;
  /**
   * C150.9: the `flow-signal-snapshot` producer, for a branch that reads signals; a caller without
   * one leaves the request to the session poll and `flow-action-sweep`.
   */
  flowSignalSnapshots?: FlowSignalSnapshotQueue | undefined;
}

/** How the current step was left (C151.2's exits). */
export type FlowExit =
  | { kind: 'consent-recorded'; sessionId: string }
  | {
      kind: 'verification-decided';
      verificationId: string;
      verificationType: VerificationType;
      status: VerificationStatus;
      /** `flow`: the attempt the flow API created; `workflow-action`: Phase 8's sandbox action. */
      origin: 'flow' | 'workflow-action';
    }
  | { kind: 'screen-submitted'; stepId: string; port: string }
  | { kind: 'action-finished'; stepId: string; entry: number; port: 'next' | 'error' }
  | { kind: 'signal-snapshot-written'; stepRecordSeq: number }
  | { kind: 'wait-elapsed'; stepRecordSeq: number }
  | {
      kind: 'handoff-resolved';
      resolution: 'continued-here' | 'redeemed' | 'rejected' | 'declined';
    }
  /**
   * C207.9 (Phase 10, Workflow 10C): the session's client reported that it cannot read a document
   * chip. The current `nfc` step is left at once through `exhausted`, whatever attempts remain, as
   * `api-nfc`'s `clientUnableLeave` (`services/client-unable.ts`) says; self-asserted, never a pass.
   */
  | {
      kind: 'client-unable';
      verificationId: string;
      reason: ClientUnableReason;
      platform: ClientUnablePlatform;
    };

/**
 * What advancing left for the caller: the events it dispatches after its commit, and the work that
 * may run only once the move is committed (a branch's snapshot request, a started run's wake),
 * which the caller runs with {@link runFlowAfterCommit}.
 */
export interface FlowAdvance {
  staged: StagedEvent[];
  after: readonly (() => Promise<void>)[];
}

/** Nothing staged, nothing to run: what an exit that moves nothing answers. */
export const NO_FLOW_ADVANCE: FlowAdvance = Object.freeze({ staged: [], after: [] });

/** Runs an advance's after-commit work, in order; call it once the transaction committed. */
export async function runFlowAfterCommit(advance: FlowAdvance | null | undefined): Promise<void> {
  for (const run of advance?.after ?? []) {
    await run();
  }
}

/**
 * Advances the inquiry's position from `exit` (C151.2), in `tx` (the caller holds the inquiry's row
 * lock). An exit that is not the current step's (a decision of a verification the flow did not
 * create, a consent once the flow moved on) moves nothing. An inquiry the engine never positioned
 * is positioned by the session read and by the flow requests that can write (consent, a screen,
 * C151.14); a decision of such an inquiry moves nothing, and its settlement keeps the v1 rule
 * (every verification step of the flow).
 */
export async function advanceFlowInTx(
  tx: Db,
  deps: AdvanceFlowDeps,
  inquiry: FlowInquiryRef,
  exit: FlowExit,
): Promise<FlowAdvance> {
  if (exit.kind === 'verification-decided' && exit.origin === 'workflow-action') {
    // C151.4: a verification a workflow created is never the current step's attempt.
    return { staged: [], after: [] };
  }
  const ctx = await loadEngine(tx, deps, inquiry);
  if (ctx === null) {
    return { staged: [], after: [] };
  }
  if (ctx.inquiry.flowStepId === null) {
    if (POSITIONING_EXITS.has(exit.kind)) {
      await ensurePosition(ctx);
      if (exit.kind === 'screen-submitted') {
        await applyExit(ctx, exit);
      }
    }
    return advanceOf(ctx);
  }
  await applyExit(ctx, exit);
  return advanceOf(ctx);
}

/**
 * The exits of a flow request that can position an unpositioned inquiry (C151.14). A handoff
 * resolved on an inquiry never positioned (its session never read) keeps Phase 7's own state
 * machine, which answers every later handoff request with its own codes.
 */
const POSITIONING_EXITS: ReadonlySet<FlowExit['kind']> = new Set([
  'consent-recorded',
  'screen-submitted',
]);
