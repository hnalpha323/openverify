/**
 * C152 (Workflow 9A): runs the `action` step the engine's walk reached, exactly once per entry, in
 * the transaction that enters it: `run_workflow` (through `startFlowRunInTx`, waiting on the run),
 * `copy_extractions`, `update_account_fields` (its copy recorded on the action row, V08),
 * `tag_inquiry` and `flag_for_review`. Owner: `api-flow-actions`; `advanceFlowInTx`
 * (`api-flow-engine`) calls it under the inquiry's row lock. Frozen by `foundation-9a` (Stage 1b (S)).
 *
 * Exactly once: the entry's action row is its claim. A repeat of an entry that has a row runs
 * nothing again and answers how it ended (or, for a waiting `run_workflow`, how it stands now). A
 * redacted inquiry is never touched (Phase 6's guard): no row, no write, the `error` port.
 */
import {
  finishInquiryFlowActionInTx,
  getInquiry,
  getInquiryFlowAction,
  insertInquiryFlowActionInTx,
  type Db,
  type InquiryFlowAction,
} from '@openverify/db';
import type { FlowAction } from '@openverify/flow-spec';
import type { JsonValue } from '@openverify/workflow-engine';
import type { StagedEvent } from '../events/index.js';
import type { AdvanceFlowDeps, FlowInquiryRef } from '../flow-engine/advance.js';
import type { IdGenerator, WorkflowStepQueue } from '../ports.js';
import {
  copyExtractionsInTx,
  flagForReview,
  tagInquiryInTx,
  updateAccountFieldsInTx,
  type InstantResult,
} from './instant-actions.js';
import { enterRunWorkflowInTx, settleRunWorkflowInTx } from './run-workflow.js';

/** The flow scope's roots the engine assembled (C150.2), read for a mapping's scope paths. */
export type FlowScopeRoots = Readonly<Record<string, JsonValue | undefined>>;

/** The action step entered, and which entry of it this is (1, 2, ...). */
export interface FlowActionEntry {
  stepId: string;
  entry: number;
  action: FlowAction;
  /**
   * The scope at the step, for `update_account_fields` and `run_workflow` mappings that read a
   * path; without it such a mapping takes `error` (`scope_unavailable`).
   */
  scope?: FlowScopeRoots | undefined;
}

/**
 * What the entry did: done now (`next` or `error`), or waiting (a `run_workflow` until its run
 * ends or its timeout), with the events to dispatch after the commit and the work to run after it
 * (`after`, a started run's wake). `notes` are codes for the step record (`flag_for_review:<code>`).
 * A waiting answer with `cancelDue` has passed its timeout while its run still runs: run `after`
 * (which cancels the run outside the inquiry's lock) and settle again.
 */
export type FlowActionOutcome =
  | {
      state: 'done';
      port: 'next' | 'error';
      errorType: string | null;
      staged: StagedEvent[];
      notes?: readonly string[] | undefined;
      after?: (() => Promise<void>) | undefined;
    }
  | {
      state: 'waiting';
      retryAfterMs: number;
      staged: StagedEvent[];
      after?: (() => Promise<void>) | undefined;
      cancelDue?: boolean | undefined;
    };

/**
 * What the actions read beyond the engine's deps, each optional so the engine's `AdvanceFlowDeps`
 * fits: the root database (for work after the commit), ids, and Phase 8's step producer and
 * in-flight cap, which a started run's first steps are enqueued with (without them the workflow
 * sweep takes the steps).
 */
export interface FlowActionDeps extends AdvanceFlowDeps {
  db?: Db | undefined;
  ids?: IdGenerator | undefined;
  workflowSteps?: WorkflowStepQueue | undefined;
  workflowInFlightCap?: number | undefined;
}

type FlowActionDone = Extract<FlowActionOutcome, { state: 'done' }>;

const done = (
  port: 'next' | 'error',
  errorType: string | null,
  more: Partial<FlowActionDone> = {},
): FlowActionDone => ({ state: 'done', port, errorType, staged: [], ...more });

/** The notes an entry's step record carries, from its action's own configuration. */
const notesOf = (action: FlowAction): readonly string[] | undefined =>
  action.kind === 'flag_for_review' ? flagForReview(action).notes : undefined;

/** How a finished row ended, for a repeat of its entry. */
function replay(row: InquiryFlowAction, action: FlowAction): FlowActionDone {
  if (row.status === 'completed') {
    const notes = notesOf(action);
    return done('next', null, notes === undefined ? {} : { notes });
  }
  return done('error', row.errorType);
}

async function runInstantInTx(
  tx: Db,
  deps: FlowActionDeps,
  inquiry: Parameters<typeof tagInquiryInTx>[2],
  entry: FlowActionEntry,
  action: Exclude<FlowAction, { kind: 'run_workflow' }>,
): Promise<InstantResult> {
  switch (action.kind) {
    case 'tag_inquiry':
      return tagInquiryInTx(tx, deps, inquiry, entry, action);
    case 'flag_for_review':
      return flagForReview(action);
    case 'update_account_fields':
      return updateAccountFieldsInTx(tx, deps, inquiry, entry, action);
    case 'copy_extractions':
      return copyExtractionsInTx(tx, inquiry, entry, action);
  }
}

/** A step entered, waiting or done (`run_workflow`), or done at once (every other kind). */
async function enterInTx(
  tx: Db,
  deps: FlowActionDeps,
  row: Parameters<typeof tagInquiryInTx>[2],
  entry: FlowActionEntry,
): Promise<FlowActionOutcome> {
  const { action } = entry;
  if (action.kind === 'run_workflow') {
    return enterRunWorkflowInTx(tx, deps, row, entry, action);
  }
  const { environmentId } = row;
  const key = { inquiryId: row.id, stepId: entry.stepId, entry: entry.entry };
  const now = deps.clock.now();
  const result = await runInstantInTx(tx, deps, row, entry, action);
  await insertInquiryFlowActionInTx(tx, environmentId, { ...key, enteredAt: now });
  await finishInquiryFlowActionInTx(tx, environmentId, key, {
    status: result.port === 'next' ? 'completed' : 'errored',
    errorType: result.errorType,
    finishedAt: now,
    ...(result.copy ?? {}),
  });
  return done(result.port, result.errorType, {
    staged: result.staged,
    ...(result.notes === undefined ? {} : { notes: result.notes }),
  });
}

/** Runs the entry (C152). */
export async function runFlowActionInTx(
  tx: Db,
  deps: FlowActionDeps,
  inquiry: FlowInquiryRef,
  entry: FlowActionEntry,
): Promise<FlowActionOutcome> {
  const { environmentId, inquiryId } = inquiry;
  const row = await getInquiry(tx, environmentId, inquiryId);
  if (row?.redactedAt !== null) {
    return done('error', 'inquiry_redacted');
  }
  const key = { inquiryId, stepId: entry.stepId, entry: entry.entry };
  const existing = await getInquiryFlowAction(tx, environmentId, key);
  if (existing !== null) {
    return existing.status === 'running'
      ? settleFlowActionInTx(tx, deps, inquiry, entry)
      : replay(existing, entry.action);
  }
  return enterInTx(tx, deps, row, entry);
}

/**
 * C152.2: how a waiting entry stands now (its run ended, its timeout passed, or still waiting), for
 * the session poll and `flow-action-sweep`, under the inquiry's lock.
 */
export async function settleFlowActionInTx(
  tx: Db,
  deps: FlowActionDeps,
  inquiry: FlowInquiryRef,
  entry: FlowActionEntry,
): Promise<FlowActionOutcome> {
  const existing = await getInquiryFlowAction(tx, inquiry.environmentId, {
    inquiryId: inquiry.inquiryId,
    stepId: entry.stepId,
    entry: entry.entry,
  });
  if (existing === null) {
    // Never entered: nothing to wait for (the engine enters it with `runFlowActionInTx`).
    return done('error', 'action_not_entered');
  }
  if (existing.status !== 'running' || entry.action.kind !== 'run_workflow') {
    return replay(existing, entry.action);
  }
  return settleRunWorkflowInTx(tx, deps, inquiry, existing, entry.action);
}
