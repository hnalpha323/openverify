/**
 * C207.9 (Phase 10, Workflow 10C): a client says it cannot read a document chip. Owned by
 * `api-nfc`; `contracts-10c` froze the route (`routes/flow/client-unable.ts`) and placed the three
 * hooks below in the shared engine, each a call to a stub here:
 *
 * - {@link reportClientUnable}, the route's service: accepted only for the current step of type
 *   `nfc`, at most once per verification (409 `client_unable_not_allowed` otherwise). It records
 *   the reason and the client's platform as client-reported, ends the verification without passing
 *   (`canceled`), and advances through `advanceFlowInTx` with the exit `client-unable`.
 * - {@link clientUnableLeave}, called by `flow-engine/exits.ts` for that exit: how the current
 *   `nfc` step is left, at once, whatever attempts remain.
 * - {@link clientUnableStepOutcomes}, called by `flow-engine/engine.ts`'s `decideOutcome`: how a
 *   step left that way reads when the inquiry settles (the always-review rule).
 *
 * The report is self-asserted: it never passes a check, and the person is never told that the
 * fallback goes to review (rule 10).
 *
 * The always-review rule (C207.9; review P02): `flowOutcome` sends a step left through `exhausted`
 * to review unless its exit carries `fallback-continue`, which this module writes only where the
 * pinned version carries the acknowledgement `client-unable:<step id>` and the step's `onFallback`
 * is `continue`. Phase 9's `fallback:<step id>` alone never does it: it covers a person who tried
 * and failed, not a claim that no reader exists.
 */
import { CLIENT_UNABLE_NOTE_PREFIXES, FLOW_STEP_NOTES, type FlowV2 } from '@openverify/flow-spec';
import type {
  ClientUnablePlatform,
  ClientUnableReason,
  FlowClientUnableBody,
  FlowClientUnableResponse,
} from '@openverify/contracts';
import { getInquirySession, type Db, type Inquiry, type InquiryFlowStep } from '@openverify/db';
import type { FlowSession } from '../auth/flow-session.js';
import { Phase10FlowProblemError } from '../errors.js';
import type { StagedEvent } from '../events/index.js';
import type { FlowAdvance } from '../flow-engine/advance.js';
import { pinnedFlowOf } from '../flow-engine/pinned-flow.js';
import type { ApiDependencies } from './context.js';
import { requireFlowVerification, requireFlowVerificationUnderLock } from './flow-preconditions.js';
import { governmentIdNfcSubResources } from './sub-resources/government-id-nfc.js';
import {
  fileIdsByVerification,
  moveVerification,
  stageVerificationEvent,
} from './verifications.js';

/** The step record's outcome of a step left by a client-unable report. */
export const CLIENT_UNABLE_OUTCOME = 'client_unable';

/** C207.9: the one body of every refusal (its golden problem's detail). */
export const CLIENT_UNABLE_NOT_ALLOWED_DETAIL =
  'The verification cannot be reported as unreadable by this client now.';

const notAllowed = (): Phase10FlowProblemError =>
  new Phase10FlowProblemError('client_unable_not_allowed', CLIENT_UNABLE_NOT_ALLOWED_DETAIL);

/** The platform a session's client facts name (`mobile-sdk-name`, Phase 7 C94.5); else the web. */
export function clientUnablePlatformOf(mobileSdkName: string | null): ClientUnablePlatform {
  if (mobileSdkName === 'openverify-android') {
    return 'android';
  }
  return mobileSdkName === 'openverify-ios' ? 'ios' : 'web';
}

/**
 * Whether the inquiry's position is an active `nfc` step with an `exhausted` edge: the only place
 * a client-unable report is taken (C207.9, C151.12: a client moves the position only through the
 * current step's own exit).
 */
function atNfcStepWithFallback(inquiry: Inquiry, flow: FlowV2): boolean {
  if (inquiry.flowStepId === null || inquiry.flowState !== 'active') {
    return false;
  }
  const step = flow.steps.find((candidate) => candidate.id === inquiry.flowStepId);
  return (
    step?.type === 'nfc' &&
    flow.edges.some((edge) => edge.from === step.id && edge.port === 'exhausted')
  );
}

/**
 * `POST /api/v1/flow/verifications/:id/client-unable`. C52.1's preconditions run first (another
 * inquiry's verification 404, a finished inquiry 409, a redacted one 410, no consent 409, another
 * type 422, a verification no longer `initiated` 409, which is what refuses a second report).
 * Then, under the C40.6 locks: 409 `client_unable_not_allowed` unless the current step is an `nfc`
 * step with an `exhausted` edge; the verification ends `canceled` (`verification.canceled`, never
 * a pass), its open challenge is closed, and the engine leaves the step through `exhausted` with
 * the reason and the session's platform as client-reported notes. The answer says nothing of
 * where the flow goes or how the inquiry settles: the client reads the session.
 * @throws {Phase10FlowProblemError} 409 `client_unable_not_allowed`.
 */
export async function reportClientUnable(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
  body: FlowClientUnableBody,
): Promise<FlowClientUnableResponse> {
  const { db, clock, events } = deps;
  const { environmentId } = session;
  const { verification } = await requireFlowVerification(deps, session, verificationId, {
    types: ['government_id_nfc'],
  });
  const stored = await getInquirySession(db, environmentId, session.id);
  const platform = clientUnablePlatformOf(stored?.mobileSdkName ?? null);
  // The engine imports this module for its two hooks (`exits.ts`, `engine.ts`), so its entry is
  // loaded here, at the call, never while either module is still being evaluated.
  const { advanceFlowInTx, runFlowAfterCommit } = await import('../flow-engine/advance.js');

  const outcome = await db.transaction(
    async (tx: Db): Promise<{ staged: StagedEvent[]; advance: FlowAdvance }> => {
      const locked = await requireFlowVerificationUnderLock(tx, session, verification.id);
      const pinned = await pinnedFlowOf(tx, locked.inquiry);
      if (pinned === null || !atNfcStepWithFallback(locked.inquiry, pinned.flow)) {
        throw notAllowed();
      }
      const current = { ...locked.verification, checks: verification.checks };
      const staged = [
        ...(await governmentIdNfcSubResources.onVerificationCanceled(tx, events, current)).staged,
      ];
      const moved = await moveVerification(tx, current, 'canceled', clock.now());
      if (moved === null) {
        // The verification row is locked, so only a change before the lock gets here.
        throw notAllowed();
      }
      if (moved.event !== null) {
        const files = await fileIdsByVerification(tx, environmentId, [verification.id]);
        staged.push(
          await stageVerificationEvent(
            tx,
            events,
            moved.event,
            { ...moved.verification, checks: verification.checks },
            files.get(verification.id) ?? [],
          ),
        );
      }
      const advance = await advanceFlowInTx(
        tx,
        deps,
        { environmentId, inquiryId: locked.inquiry.id },
        { kind: 'client-unable', verificationId: verification.id, reason: body.reason, platform },
      );
      return { staged: [...staged, ...advance.staged], advance };
    },
  );
  await events.dispatch(outcome.staged);
  await runFlowAfterCommit(outcome.advance);
  return { 'verification-id': verification.id, status: 'canceled' };
}

/** What the engine knows when a client-unable exit reaches the current `nfc` step. */
export interface ClientUnableExitInput {
  /** The current step's id. */
  stepId: string;
  /** The step's `onFallback` (C150.6), when it has one. */
  onFallback: string | null;
  /** Whether the pinned flow has an `exhausted` edge from the step. */
  hasExhaustedEdge: boolean;
  /** The pinned version's stored publish acknowledgements, as `inquiry_template_versions` holds them. */
  acknowledgements: readonly unknown[];
  reason: ClientUnableReason;
  platform: ClientUnablePlatform;
}

/** How the engine leaves the step: the port, the record's outcome and its notes. */
export interface ClientUnableLeave {
  port: 'exhausted';
  /** The step record's outcome code (`^[a-z][a-z0-9_:-]{0,127}$`). */
  outcome: string;
  /**
   * `FLOW_STEP_NOTES.clientUnable` with the reason and platform notes
   * (`CLIENT_UNABLE_NOTE_PREFIXES`), and `FLOW_STEP_NOTES.fallbackContinue` only where the rule
   * allows the inquiry to complete without review.
   */
  notes: string[];
}

/** Whether the stored acknowledgements hold `key` (the C154.9 form: `{key, acknowledged-by, acknowledged-at}`). */
function acknowledges(acknowledgements: readonly unknown[], key: string): boolean {
  return acknowledgements.some(
    (entry) =>
      typeof entry === 'object' && entry !== null && (entry as { key?: unknown }).key === key,
  );
}

/**
 * How the current `nfc` step is left by a client-unable report; `null` leaves it where it is (a
 * step without an `exhausted` edge has nowhere to go). The exit is recorded as client-reported:
 * the note `client-unable`, the reason and the platform. `fallback-continue` rides only where the
 * version carries `client-unable:<step id>` and the step's `onFallback` is `continue`; everywhere
 * else the inquiry goes to review at completion.
 */
export function clientUnableLeave(input: ClientUnableExitInput): ClientUnableLeave | null {
  if (!input.hasExhaustedEdge) {
    return null;
  }
  const continues =
    input.onFallback === 'continue' &&
    acknowledges(input.acknowledgements, `client-unable:${input.stepId}`);
  return {
    port: 'exhausted',
    outcome: CLIENT_UNABLE_OUTCOME,
    notes: [
      FLOW_STEP_NOTES.clientUnable,
      `${CLIENT_UNABLE_NOTE_PREFIXES.reason}${input.reason}`,
      `${CLIENT_UNABLE_NOTE_PREFIXES.platform}${input.platform}`,
      ...(continues ? [FLOW_STEP_NOTES.fallbackContinue] : []),
    ],
  };
}

/** The statuses a settlement reads as decided (`flowOutcome`'s). */
const DECIDED_OUTCOMES: ReadonlySet<string> = new Set([
  'passed',
  'failed',
  'needs_review',
  'skipped',
]);

/**
 * The verification outcomes by step id as the settlement reads them (`flowOutcome`), given the
 * step record: a step whose last entry was left through `exhausted` by a client-unable report is
 * decided without passing (`failed`), so its fallback settles the inquiry (to review, unless its
 * exit carries `fallback-continue`). Its canceled attempt would otherwise read `pending`, and a
 * completion never settles over a pending step. A step that already reads decided keeps its
 * outcome, and the outcomes given are never changed.
 */
export function clientUnableStepOutcomes(
  record: readonly Pick<InquiryFlowStep, 'stepId' | 'exitPort' | 'notes'>[],
  outcomes: Record<string, string>,
): Record<string, string> {
  const last = new Map<string, Pick<InquiryFlowStep, 'stepId' | 'exitPort' | 'notes'>>();
  for (const entry of record) {
    last.set(entry.stepId, entry);
  }
  const read = { ...outcomes };
  for (const entry of last.values()) {
    if (
      entry.exitPort === 'exhausted' &&
      entry.notes.includes(FLOW_STEP_NOTES.clientUnable) &&
      !DECIDED_OUTCOMES.has(read[entry.stepId] ?? 'pending')
    ) {
      read[entry.stepId] = 'failed';
    }
  }
  return read;
}
