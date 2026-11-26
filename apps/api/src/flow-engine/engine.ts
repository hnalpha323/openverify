/**
 * C151.1-C151.3 (Workflow 9A, api-flow-engine): the server flow engine. Each exit of the current
 * step is recorded and the position moved in the caller's transaction, under the inquiry's row lock
 * (the caller holds it), so no reader ever sees a finished step as current:
 *
 * - the walk is `nextPosition` of `@openverify/flow-spec` (shared with simulate, review H16) over the
 *   scope assembled on the server (`scope.ts`) with the one server evaluator (`evaluator.ts`);
 * - every step entered is appended to the step record, every branch passed is entered and left with
 *   its port, its `onNull` notes and the `sensitive` mark (a route reading a PII-marked path, P15);
 * - a verification step whose attempts are already decided is left at once (the silent AAMVA step,
 *   C59.6, and a replay, C151.14): `next` when it passed, was skipped or is in review, `exhausted`
 *   when it ended without passing and has that edge, else the inquiry fails;
 * - an `action` step is run through `runFlowActionInTx` (`api-flow-actions`) once per entry;
 * - a terminal step, a verification ending without a fallback, and `scope_path_missing` settle the
 *   inquiry by `flowOutcome` (C151.3) through `transitionInquiryInTx`, which keeps Phase 6's
 *   redacted-inquiry guard (a redacted inquiry is never moved): `needs_review` is two moves in one
 *   transaction, `pending -> completed -> needs_review`, so the completion's outbox rows are written.
 */
import { STEP_VERIFICATION_TYPES, type SupportedVerificationType } from '@openverify/contracts';
import {
  appendInquiryFlowStepInTx,
  exitInquiryFlowStepInTx,
  getInquiry,
  getInquirySession,
  getLatestInquiryConsent,
  listInquiryFlowSteps,
  listInquiryVerifications,
  listVerificationInputSources,
  setInquiryFlowOutcomeInTx,
  setInquiryFlowPositionInTx,
  type Db,
  type Inquiry,
  type InquiryFlowStep,
  type VerificationWithChecks,
} from '@openverify/db';
import {
  FLOW_SCOPE_EXTRACTIONS,
  FLOW_STEP_NOTES,
  flowOutcome,
  nextPosition,
  resumeAt,
  type FlowOutcomeDecision,
  type FlowV2,
  type FlowV2Step,
  type NextPosition,
  type RouteTaken,
} from '@openverify/flow-spec';
import type { FlowRecordState } from '@openverify/core';
import type { StagedEvent } from '../events/index.js';
import { recordFlowFailureInTx, type FlowFailureVerdict } from '../flow-actions/failure.js';
import { FlowActionNotBuiltError } from '../flow-actions/not-built.js';
import { runFlowActionInTx, type FlowActionOutcome } from '../flow-actions/run-action.js';
import { requestSignalSnapshot } from '../flow-actions/signal-snapshot.js';
import { handoffOptionsOf, skipsHandoff } from '../services/handoff/steps.js';
import { transitionInquiryInTx } from '../services/inquiries.js';
import type { AdvanceFlowDeps, FlowAdvance, FlowInquiryRef } from './advance.js';
import { conditionPaths, flowConditionEvaluator } from './evaluator.js';
import { clientUnableStepOutcomes } from '../services/client-unable.js';
import { pinnedFlowOf, type PinnedFlow } from './pinned-flow.js';
import { assembleFlowScope } from './scope.js';
import { stepVerificationOutcome } from './verification-state.js';
import { countedVerifications } from '../services/connect/cloned-results.js';
import { destinationShareConsentSkipped } from '../services/flow-views/share-consent.js';

/** C151.1: the codes the engine writes beside `FLOW_STEP_NOTES`. */
export const ENGINE_NOTES = Object.freeze({
  waitedForFacts: 'waited_for_facts',
  edgeMissing: 'edge_missing',
  /** C152.6: the code a `flag_for_review` action raised, as `flag_for_review:<code>`. */
  flagForReviewPrefix: 'flag_for_review:',
  /** C96.3 (Phase 7): the desktop rejected the phone's handoff; the handoff step shows again. */
  handoffRejected: 'handoff_rejected',
} as const);

/** The port an entry is closed with when a rejected handoff takes the position back (C96.3). */
export const HANDOFF_REJECTED_PORT = 'rejected';

/**
 * C96.3 (Phase 7): the latest entry of a `device_handoff` step, when a phone's redemption left it
 * and the position has not gone back to it since: the state in which the desktop may reject the
 * phone ("this was not me").
 */
export function redeemedHandoffEntry(record: readonly InquiryFlowStep[]): InquiryFlowStep | null {
  const entry = record.findLast((candidate) => candidate.stepType === 'device_handoff');
  return entry !== undefined && entry.exitPort !== null && entry.outcome === 'redeemed'
    ? entry
    : null;
}

/** C96.3: the latest entry of a `device_handoff` step, when the path left it (any resolution). */
export function resolvedHandoffEntry(record: readonly InquiryFlowStep[]): InquiryFlowStep | null {
  const entry = record.findLast((candidate) => candidate.stepType === 'device_handoff');
  return entry !== undefined && entry.exitPort !== null ? entry : null;
}

/**
 * C96.3: a rejected handoff takes the position back to its step, which shows again: the open
 * entry the phone was on is closed (`rejected`), and the handoff step is entered anew, noted.
 */
export async function returnToHandoff(ctx: EngineContext, handoffStepId: string): Promise<void> {
  const open = currentEntry(ctx);
  if (open !== null) {
    await leave(ctx, open, HANDOFF_REJECTED_PORT, 'handoff-rejected');
  }
  await enter(ctx, handoffStepId, [ENGINE_NOTES.handoffRejected]);
  await setPosition(ctx, handoffStepId, 'active');
}

/** Everything one advance reads and writes, in the caller's transaction. */
export interface EngineContext {
  readonly tx: Db;
  readonly deps: AdvanceFlowDeps;
  readonly ref: FlowInquiryRef;
  inquiry: Inquiry;
  readonly pinned: PinnedFlow;
  readonly steps: ReadonlyMap<string, FlowV2Step>;
  readonly record: InquiryFlowStep[];
  readonly verifications: VerificationWithChecks[];
  readonly sources: ReadonlyMap<string, string | null>;
  readonly now: Date;
  readonly staged: StagedEvent[];
  readonly after: (() => Promise<void>)[];
  /** A waiting branch's entry being resumed: its exit closes this entry, not a new one. */
  resuming: InquiryFlowStep | null;
}

/** Reads the inquiry, its flow, record and verifications; `null` when the inquiry or flow is gone. */
export async function loadEngine(
  tx: Db,
  deps: AdvanceFlowDeps,
  ref: FlowInquiryRef,
): Promise<EngineContext | null> {
  const inquiry = await getInquiry(tx, ref.environmentId, ref.inquiryId);
  if (inquiry === null) {
    return null;
  }
  const pinned = await pinnedFlowOf(tx, inquiry);
  if (pinned === null) {
    return null;
  }
  // C235.4, C235.7 (Workflow 11A Stage 1b (R), `foundation-11a`'s hook): a clone that does not
  // count is absent from every step outcome, exit and decision (`api-redeem`'s cloned-results.ts).
  const verifications = await countedVerifications(
    tx,
    inquiry,
    await listInquiryVerifications(tx, ref.environmentId, ref.inquiryId),
    deps.clock.now(),
  );
  const sources = await listVerificationInputSources(
    tx,
    ref.environmentId,
    verifications.filter((verification) => verification.type === 'aamva').map(({ id }) => id),
  );
  return {
    tx,
    deps,
    ref,
    inquiry,
    pinned,
    steps: new Map(pinned.flow.steps.map((step) => [step.id, step])),
    record: await listInquiryFlowSteps(tx, ref.environmentId, ref.inquiryId),
    verifications,
    sources,
    now: deps.clock.now(),
    staged: [],
    after: [],
    resuming: null,
  };
}

/** What an advance leaves for its caller. */
export const advanceOf = (ctx: EngineContext): FlowAdvance => ({
  staged: ctx.staged,
  after: ctx.after,
});

const isPersonVisible = (step: FlowV2Step | undefined): boolean =>
  step !== undefined && step.type !== 'branch' && step.type !== 'action';

const edgeTarget = (flow: FlowV2, from: string, port: string): string | undefined =>
  flow.edges.find((edge) => edge.from === from && edge.port === port)?.to;

/** The open entry of the step the position names (the latest entry of that step, not exited). */
export function currentEntry(ctx: EngineContext): InquiryFlowStep | null {
  const stepId = ctx.inquiry.flowStepId;
  const entry = ctx.record.at(-1);
  return stepId !== null && entry?.stepId === stepId && entry.exitedAt === null ? entry : null;
}

/** The person-visible step exited last (never a branch or an action, review P14). */
function previousVisible(ctx: EngineContext): string | null {
  for (let index = ctx.record.length - 1; index >= 0; index -= 1) {
    const entry = ctx.record[index];
    if (entry?.exitedAt != null && isPersonVisible(ctx.steps.get(entry.stepId))) {
      return entry.stepId;
    }
  }
  return null;
}

async function enter(
  ctx: EngineContext,
  stepId: string,
  notes: readonly string[] = [],
): Promise<InquiryFlowStep> {
  const step = ctx.steps.get(stepId);
  const entry = await appendInquiryFlowStepInTx(ctx.tx, ctx.ref.environmentId, {
    inquiryId: ctx.ref.inquiryId,
    stepId,
    stepType: step?.type ?? 'unknown',
    enteredAt: ctx.now,
    notes,
  });
  ctx.record.push(entry);
  return entry;
}

async function leave(
  ctx: EngineContext,
  entry: InquiryFlowStep,
  port: string,
  outcome: string | null,
  options: { notes?: readonly string[]; sensitive?: boolean; waited?: boolean } = {},
): Promise<void> {
  const exited = await exitInquiryFlowStepInTx(
    ctx.tx,
    ctx.ref.environmentId,
    ctx.ref.inquiryId,
    entry.seq,
    {
      exitedAt: ctx.now,
      exitPort: port,
      outcome,
      waitedMs:
        options.waited === true ? Math.max(0, ctx.now.getTime() - entry.enteredAt.getTime()) : null,
      sensitive: options.sensitive ?? false,
      notes: options.notes ?? [],
    },
  );
  const index = ctx.record.findIndex((row) => row.seq === entry.seq);
  if (exited !== null && index >= 0) {
    ctx.record[index] = exited;
  }
}

async function setPosition(
  ctx: EngineContext,
  stepId: string,
  state: FlowRecordState,
): Promise<void> {
  const previousStepId = previousVisible(ctx);
  await setInquiryFlowPositionInTx(ctx.tx, ctx.ref.environmentId, ctx.ref.inquiryId, {
    stepId,
    state,
    previousStepId,
    specVersion: ctx.pinned.specVersion,
  });
  ctx.inquiry = {
    ...ctx.inquiry,
    flowStepId: stepId,
    flowState: state,
    flowPreviousStepId: previousStepId,
    flowSpecVersion: ctx.pinned.specVersion,
  };
}

/** C151.1 (P15): a PII-marked path: a field (fail closed, whatever its mark) or a PII extraction. */
const PII_EXTRACTIONS: ReadonlySet<string> = new Set(
  Object.values(FLOW_SCOPE_EXTRACTIONS)
    .flat()
    .filter((extraction) => extraction.pii)
    .map((extraction) => extraction.attribute),
);

function readsPii(step: FlowV2Step | undefined): boolean {
  if (step?.type !== 'branch') {
    return false;
  }
  return step.routes
    .flatMap((route) => conditionPaths(route.condition))
    .some(
      (path) =>
        path.startsWith('inquiry.fields.') ||
        (path.startsWith('verifications.') && PII_EXTRACTIONS.has(path.split('.')[2] ?? '')),
    );
}

const visitsOf = (record: readonly InquiryFlowStep[]): Record<string, number> => {
  const visits: Record<string, number> = {};
  for (const entry of record) {
    visits[entry.stepId] = (visits[entry.stepId] ?? 0) + 1;
  }
  return visits;
};

/** How many times the record entered `stepId`: an action's entry number (C152.2). */
export const entriesOf = (ctx: EngineContext, stepId: string): number =>
  visitsOf(ctx.record)[stepId] ?? 0;

const readsRoot = (flow: FlowV2, root: string): boolean =>
  flow.steps.some(
    (step) =>
      step.type === 'branch' &&
      step.routes.some((route) =>
        conditionPaths(route.condition).some((path) => path.startsWith(`${root}.`)),
      ),
  );

async function scopeFor(ctx: EngineContext, branchSeq: number | null) {
  return assembleFlowScope(ctx.tx, {
    inquiry: ctx.inquiry,
    flow: ctx.pinned.flow,
    verifications: ctx.verifications,
    sources: ctx.sources,
    now: ctx.now,
    branchSeq,
    reads: {
      signals: readsRoot(ctx.pinned.flow, 'signals'),
      workflows: readsRoot(ctx.pinned.flow, 'workflows'),
    },
  });
}

/** Leaves `from` through `port` and walks on (C151.2). */
export async function moveOn(ctx: EngineContext, from: string, port: string): Promise<void> {
  const scope = await scopeFor(ctx, null);
  const walk = nextPosition(
    ctx.pinned.flow,
    scope.values,
    from,
    port,
    flowConditionEvaluator(ctx.pinned.flow, scope),
    { visits: visitsOf(ctx.record), moves: ctx.record.length },
  );
  await apply(ctx, walk);
}

/** Re-enters the waiting branch of `entry` (C150.5, C150.9): its facts arrived, or its wait ended. */
export async function resumeBranch(
  ctx: EngineContext,
  entry: InquiryFlowStep,
  waited: boolean,
): Promise<void> {
  const scope = await scopeFor(ctx, entry.seq);
  ctx.resuming = entry;
  const walk = resumeAt(
    ctx.pinned.flow,
    scope.values,
    entry.stepId,
    flowConditionEvaluator(ctx.pinned.flow, scope),
    {
      visits: visitsOf(ctx.record),
      moves: ctx.record.length,
      waited: waited ? [entry.stepId] : [],
    },
  );
  await apply(ctx, walk);
}

async function recordTaken(ctx: EngineContext, taken: readonly RouteTaken[]): Promise<void> {
  for (const route of taken) {
    const step = ctx.steps.get(route.branchId);
    const resumed = ctx.resuming?.stepId === route.branchId ? ctx.resuming : null;
    ctx.resuming = null;
    const entry = resumed ?? (await enter(ctx, route.branchId));
    await leave(ctx, entry, route.port, null, {
      notes: [...(resumed === null ? [] : [ENGINE_NOTES.waitedForFacts]), ...route.notes],
      sensitive: readsPii(step),
      waited: resumed !== null,
    });
  }
}

async function apply(ctx: EngineContext, walk: NextPosition): Promise<void> {
  await recordTaken(ctx, walk.taken);
  switch (walk.kind) {
    case 'step': {
      const entry = await enter(ctx, walk.stepId);
      await setPosition(ctx, walk.stepId, 'active');
      await leaveIfDecided(ctx, entry);
      return;
    }
    case 'action':
      await runAction(ctx, walk.stepId);
      return;
    case 'wait': {
      const resumed = ctx.resuming?.stepId === walk.stepId ? ctx.resuming : null;
      ctx.resuming = null;
      const entry = resumed ?? (await enter(ctx, walk.stepId));
      await setPosition(ctx, walk.stepId, 'waiting');
      requestSnapshot(ctx, entry, walk.facts);
      return;
    }
    case 'terminal':
      await enter(ctx, walk.stepId);
      await setPosition(ctx, walk.stepId, 'ended');
      await settle(
        ctx,
        walk.terminal === 'failure' ? await failureVerdict(ctx, walk.stepId) : null,
      );
      return;
    case 'halted':
      await halt(ctx, walk);
      return;
  }
}

async function halt(
  ctx: EngineContext,
  walk: Extract<NextPosition, { kind: 'halted' }>,
): Promise<void> {
  ctx.resuming = null;
  switch (walk.reason) {
    case 'scope_path_missing':
      // C150.4: never `else`: the person's part ends, and the inquiry goes to review.
      await enter(ctx, walk.stepId, [FLOW_STEP_NOTES.scopePathMissing]);
      await setPosition(ctx, walk.stepId, 'ended');
      await settle(ctx);
      return;
    case 'flow_loop_limit':
      await enter(ctx, walk.stepId, [FLOW_STEP_NOTES.flowLoopLimit]);
      await setPosition(ctx, walk.stepId, 'halted');
      return;
    case 'edge_missing':
      await setPosition(ctx, walk.stepId, 'halted');
      return;
  }
}

/** C150.9: the branch's named signals are snapshotted after the commit; the job advances it. */
function requestSnapshot(
  ctx: EngineContext,
  entry: InquiryFlowStep,
  facts: readonly string[],
): void {
  const names = facts
    .filter((fact) => fact.startsWith('signals.'))
    .map((fact) => fact.slice('signals.'.length));
  const queue = ctx.deps.flowSignalSnapshots;
  if (names.length === 0 || queue === undefined) {
    return;
  }
  const job = {
    environmentId: ctx.ref.environmentId,
    inquiryId: ctx.ref.inquiryId,
    stepRecordSeq: entry.seq,
    names,
  };
  ctx.after.push(() => requestSignalSnapshot(queue, job));
}

async function runAction(ctx: EngineContext, stepId: string): Promise<void> {
  const step = ctx.steps.get(stepId);
  if (step?.type !== 'action') {
    return;
  }
  const entry = await enter(ctx, stepId);
  await setPosition(ctx, stepId, 'active');
  const scope = await scopeFor(ctx, null);
  const outcome = await runFlowActionInTx(ctx.tx, ctx.deps, ctx.ref, {
    stepId,
    entry: visitsOf(ctx.record)[stepId] ?? 1,
    action: step.action,
    scope: scope.values,
  });
  await followAction(ctx, entry, step, outcome);
}

/**
 * C152.2: what an action entry answered: waiting (the position waits at the action, the session
 * polls and `flow-action-sweep` settles it), or done, whose exit is recorded with the action's notes
 * (`flag_for_review:<code>`) before the walk goes on.
 */
export async function followAction(
  ctx: EngineContext,
  entry: InquiryFlowStep,
  step: FlowV2Step,
  outcome: FlowActionOutcome,
): Promise<void> {
  ctx.staged.push(...outcome.staged);
  if (outcome.after !== undefined) {
    ctx.after.push(outcome.after);
  }
  if (outcome.state === 'waiting') {
    await setPosition(ctx, step.id, 'waiting');
    return;
  }
  await leave(
    ctx,
    entry,
    outcome.port,
    outcome.port === 'error' ? (outcome.errorType ?? 'errored') : 'completed',
    { notes: outcome.notes ?? [] },
  );
  await moveOn(ctx, step.id, outcome.port);
}

/**
 * Leaves the verification step of `entry` when its attempts are already decided (C151.2): `next`
 * when it passed, was skipped or is in review; `exhausted` when it ended without passing and has
 * that edge; otherwise an ended verification fails the inquiry, and an open one waits.
 */
export async function leaveIfDecided(ctx: EngineContext, entry: InquiryFlowStep): Promise<void> {
  const step = ctx.steps.get(entry.stepId);
  // C238.1 (Workflow 11A, `api-consent`'s named borrowed edit): a destination-side share consent on
  // an inquiry created without a share token has nothing to accept; it is skipped, wherever the step
  // is entered (the entry's positioning included).
  if (await destinationShareConsentSkipped(ctx.tx, ctx.inquiry, step)) {
    await leave(ctx, entry, 'next', 'skipped');
    await moveOn(ctx, entry.stepId, 'next');
    return;
  }
  const outcome =
    step === undefined ? null : stepVerificationOutcome(step, ctx.verifications, ctx.sources);
  if (step === undefined || outcome === null) {
    return;
  }
  if (outcome.state === 'passed' || outcome.state === 'review') {
    await leave(ctx, entry, 'next', outcome.status);
    await moveOn(ctx, step.id, 'next');
    return;
  }
  if (outcome.state !== 'exhausted') {
    return;
  }
  if (edgeTarget(ctx.pinned.flow, step.id, 'exhausted') !== undefined) {
    const onFallback = (step as { onFallback?: string }).onFallback;
    await leave(ctx, entry, 'exhausted', 'failed', {
      notes: onFallback === 'continue' ? [FLOW_STEP_NOTES.fallbackContinue] : [],
    });
    await moveOn(ctx, step.id, 'exhausted');
    return;
  }
  // C50.5 kept: with no fallback the inquiry fails; the entry stays the step it failed on.
  await setPosition(ctx, step.id, 'ended');
  await settle(ctx);
}

/**
 * C221.13 (Phase 10; Phase 7 C96.1 amended; reviews H20, V05): a session whose `mobile-sdk-name` is
 * set skips every `device_handoff` step, whatever the step's `skipOnMobile` says, because the
 * handoff's target would be the same phone. Before such a session is answered, each handoff step
 * the active position rests on is left through `next` (outcome `skipped`) and the walk goes on, so
 * the SDK is never served one. The rule is `skipsHandoff`'s, with `skipOnMobile` set aside: it then
 * answers for a native session alone, and a phone's browser keeps Phase 7's view-only skip
 * (`servedHandoffState`), the position unchanged.
 */
export async function skipHandoffForNativeSession(
  ctx: EngineContext,
  sessionId: string,
): Promise<void> {
  const session = await getInquirySession(ctx.tx, ctx.ref.environmentId, sessionId);
  if (session === null) {
    return;
  }
  // At most one skip per step of the flow: a walk that met each handoff step once has ended.
  let skips = 0;
  while (skips < ctx.pinned.flow.steps.length) {
    skips += 1;
    const entry = currentEntry(ctx);
    const step = entry === null ? undefined : ctx.steps.get(entry.stepId);
    if (
      entry === null ||
      step?.type !== 'device_handoff' ||
      ctx.inquiry.flowState !== 'active' ||
      ctx.inquiry.redactedAt !== null
    ) {
      return;
    }
    const options = { ...handoffOptionsOf(step), skipOnMobile: false };
    if (!skipsHandoff(session, options)) {
      return;
    }
    await leave(ctx, entry, 'next', 'skipped');
    await moveOn(ctx, step.id, 'next');
  }
}

/** The verification type of the step the position names, when it is a verification step. */
export function currentVerificationType(ctx: EngineContext): SupportedVerificationType | null {
  const step = ctx.inquiry.flowStepId === null ? undefined : ctx.steps.get(ctx.inquiry.flowStepId);
  if (step === undefined || !Object.hasOwn(STEP_VERIFICATION_TYPES, step.type)) {
    return null;
  }
  return STEP_VERIFICATION_TYPES[step.type as keyof typeof STEP_VERIFICATION_TYPES] ?? null;
}

/** C151.3: each entered verification step's outcome, by step id. */
export function verificationOutcomes(ctx: EngineContext): Record<string, string> {
  const outcomes: Record<string, string> = {};
  for (const step of ctx.pinned.flow.steps) {
    const outcome = stepVerificationOutcome(step, ctx.verifications, ctx.sources);
    if (outcome !== null) {
      outcomes[step.id] = outcome.status;
    }
  }
  return outcomes;
}

/** Whether the pinned flow has an edge from `from` on `port` (C207.9's `exhausted`, for `exits.ts`). */
export const hasEdge = (ctx: EngineContext, from: string, port: string): boolean =>
  edgeTarget(ctx.pinned.flow, from, port) !== undefined;

/**
 * C151.3, C152.6: the inquiry's outcome by `flowOutcome`, from the record as it is now. C207.9
 * (Workflow 10C, contracts-10c's hook): a step left by a client-unable report reads as
 * `api-nfc`'s `clientUnableStepOutcomes` says, which is what holds the always-review rule.
 */
export function decideOutcome(ctx: EngineContext): FlowOutcomeDecision {
  const flags = ctx.record
    .flatMap((entry) => entry.notes)
    .filter((note) => note.startsWith(ENGINE_NOTES.flagForReviewPrefix));
  return flowOutcome(
    ctx.record.map((entry) => ({
      stepId: entry.stepId,
      stepType: entry.stepType,
      exitPort: entry.exitPort,
      notes: entry.notes,
    })),
    clientUnableStepOutcomes(ctx.record, verificationOutcomes(ctx)),
    [...new Set(flags)],
  );
}

/**
 * C150.7: the decision record of a failure step reached, written by `api-flow-actions` before the
 * inquiry moves; its gates may send the inquiry to review instead of failing it. Until that is
 * built, the failure stands without a record.
 */
async function failureVerdict(
  ctx: EngineContext,
  failureStepId: string,
): Promise<FlowFailureVerdict | null> {
  const exits = ctx.record
    .filter((entry) => entry.exitPort !== null)
    .map((entry) => ({
      stepId: entry.stepId,
      port: entry.exitPort ?? '',
      onNull: entry.notes.includes(FLOW_STEP_NOTES.onNullReview) ? 'review' : null,
    }));
  try {
    return await recordFlowFailureInTx(ctx.tx, ctx.deps, ctx.ref, {
      templateVersionId: ctx.inquiry.inquiryTemplateVersionId,
      failureStepId,
      exits,
    });
  } catch (error) {
    if (error instanceof FlowActionNotBuiltError) {
      return null;
    }
    throw error;
  }
}

/**
 * Settles a pending inquiry once its outcome is known (C151.3): `completed`, `failed`, or
 * `completed` then `needs_review` in this transaction (a failure a C150.7 gate stopped goes to
 * review). A redacted inquiry is never moved (`transitionInquiryInTx` answers `null` and stages
 * nothing, Phase 6's guard).
 */
export async function settle(
  ctx: EngineContext,
  verdict: FlowFailureVerdict | null = null,
): Promise<void> {
  const decided = decideOutcome(ctx);
  if (decided.status === 'pending') {
    return;
  }
  const gated = decided.status === 'failed' && verdict?.outcome === 'review';
  const status = gated ? 'needs_review' : decided.status;
  const flags = [
    ...decided.outcome.flags,
    ...(gated && verdict.errorCode !== null ? [verdict.errorCode] : []),
  ];
  await setInquiryFlowOutcomeInTx(ctx.tx, ctx.ref.environmentId, ctx.ref.inquiryId, {
    verificationTypesOnPath: decided.outcome.verificationTypesOnPath,
    fallbacksTaken: decided.outcome.fallbacksTaken,
    flags,
  });
  if (ctx.inquiry.status !== 'pending') {
    return;
  }
  const moved = await transitionInquiryInTx(
    ctx.tx,
    ctx.deps,
    ctx.inquiry,
    status === 'failed' ? 'failed' : 'completed',
  );
  if (moved === null) {
    return;
  }
  ctx.staged.push(...moved.staged);
  ctx.inquiry = { ...ctx.inquiry, status: moved.inquiry.status };
  if (status !== 'needs_review' || moved.inquiry.status !== 'completed') {
    return;
  }
  const reviewed = await transitionInquiryInTx(ctx.tx, ctx.deps, moved.inquiry, 'needs_review');
  if (reviewed !== null) {
    ctx.staged.push(...reviewed.staged);
    ctx.inquiry = { ...ctx.inquiry, status: reviewed.inquiry.status };
  }
}

/** Whether a consent was recorded for the inquiry (any session). */
export async function consentRecorded(ctx: EngineContext): Promise<boolean> {
  return (await getLatestInquiryConsent(ctx.tx, ctx.ref.environmentId, ctx.ref.inquiryId)) !== null;
}

export { leave as leaveEntry, enter as enterStep, setPosition as setFlowPosition };
