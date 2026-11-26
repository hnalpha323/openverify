/**
 * C151.14, C151.10 (Workflow 9A, api-flow-engine): where the position starts. An inquiry with no
 * position is positioned once, under its row lock, by a flow request that can write (the session,
 * a consent, a screen submission): at the flow's `entry` for a fresh inquiry, on its
 * `created -> pending` move, whose expiry becomes `started-at` plus the inquiry's own after-start
 * window, else the version's `inquiry-expiration-after-start-seconds`, when either is set
 * (`expiry.ts`); or, for an inquiry already under way before the engine positioned it (every
 * inquiry at the migration, and the test factories), by replaying the migrated flow from `entry`
 * over its stored facts (a recorded consent, decided verifications).
 * The replay's entries are recorded as the walk took them, and the first carries the note
 * `position_backfilled`, so the path (which decides the required verifications) is the record.
 *
 * A decided, expired or redacted inquiry is never positioned (nothing would move it again).
 */
import { setInquiryExpiresAtInTx, type Db } from '@openverify/db';
import { FLOW_STEP_NOTES } from '@openverify/flow-spec';
import { transitionInquiryInTx } from '../services/inquiries.js';
import type { AdvanceFlowDeps, FlowAdvance, FlowInquiryRef } from './advance.js';
import {
  advanceOf,
  consentRecorded,
  currentEntry,
  enterStep,
  leaveEntry,
  leaveIfDecided,
  loadEngine,
  moveOn,
  setFlowPosition,
  type EngineContext,
} from './engine.js';
import { mayMoveExpiry, startWindowSeconds, versionExpirySettings } from './expiry.js';
import { stepVerificationOutcome } from './verification-state.js';

/**
 * C151.10: an after-start window (the inquiry's own, else its version's) moves the expiry at the
 * start; with none, or once the inquiry is already past its expiry, the start changes nothing.
 */
async function applyStartWindow(ctx: EngineContext, startedAt: Date): Promise<void> {
  const after = startWindowSeconds(ctx.inquiry, versionExpirySettings(ctx.pinned.version.settings));
  if (after === null || !mayMoveExpiry(ctx.inquiry, startedAt)) {
    return;
  }
  const expiresAt = new Date(startedAt.getTime() + after * 1000);
  await setInquiryExpiresAtInTx(ctx.tx, ctx.ref.environmentId, ctx.ref.inquiryId, expiresAt);
  ctx.inquiry = { ...ctx.inquiry, expiresAt };
}

/** Whether the inquiry holds facts a replay would pass: a consent, or a decided verification. */
async function holdsFacts(ctx: EngineContext): Promise<boolean> {
  if (await consentRecorded(ctx)) {
    return true;
  }
  return ctx.pinned.flow.steps.some((step) => {
    const outcome = stepVerificationOutcome(step, ctx.verifications, ctx.sources);
    return outcome !== null && outcome.state !== 'open';
  });
}

/**
 * Replays from the current step over the stored facts: a recorded consent leaves a consent step,
 * and a decided verification leaves its step (`leaveIfDecided`, run as each step is entered).
 */
async function replay(ctx: EngineContext): Promise<void> {
  for (let guard = 0; guard < ctx.pinned.flow.steps.length + 1; guard += 1) {
    const entry = currentEntry(ctx);
    const step = entry === null ? undefined : ctx.steps.get(entry.stepId);
    if (entry === null || step?.type !== 'consent' || !(await consentRecorded(ctx))) {
      return;
    }
    await leaveEntry(ctx, entry, 'next', 'recorded');
    await moveOn(ctx, step.id, 'next');
  }
}

/** Positions `ctx`'s inquiry when it has none yet; `true` when it did. */
export async function ensurePosition(ctx: EngineContext): Promise<boolean> {
  const { inquiry } = ctx;
  if (inquiry.flowStepId !== null || inquiry.redactedAt !== null) {
    return false;
  }
  if (inquiry.status === 'created') {
    const started = await transitionInquiryInTx(ctx.tx, ctx.deps, inquiry, 'pending');
    if (started === null) {
      return false;
    }
    ctx.staged.push(...started.staged);
    ctx.inquiry = started.inquiry;
    await applyStartWindow(ctx, started.inquiry.startedAt ?? ctx.now);
  } else if (inquiry.status !== 'pending') {
    return false;
  }
  const backfilled = await holdsFacts(ctx);
  const entry = await enterStep(
    ctx,
    ctx.pinned.flow.entry,
    backfilled ? [FLOW_STEP_NOTES.positionBackfilled] : [],
  );
  await setFlowPosition(ctx, ctx.pinned.flow.entry, 'active');
  await leaveIfDecided(ctx, entry);
  await replay(ctx);
  return true;
}

/** Positions the inquiry when it has no position yet; a no-op otherwise. */
export async function positionFlowInTx(
  tx: Db,
  deps: AdvanceFlowDeps,
  inquiry: FlowInquiryRef,
): Promise<FlowAdvance> {
  const ctx = await loadEngine(tx, deps, inquiry);
  if (ctx === null) {
    return { staged: [], after: [] };
  }
  await ensurePosition(ctx);
  return advanceOf(ctx);
}
