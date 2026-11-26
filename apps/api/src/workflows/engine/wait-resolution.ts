/**
 * C119.2, C119.3: waits. A wait for events is matched after commit, never inside a domain
 * transaction, so an operator's filter can never slow or fail one.
 *
 * - `stage()` writes one candidate per staged event whose (environment, name) a published version
 *   waits on, in the event's own transaction, with no lock ({@link recordWaitCandidatesInTx}).
 * - A wait enters `waiting` in the transaction that completes its predecessor: it takes the advisory
 *   lock on (environment, correlation key) first, records its snapshot and transaction id, then looks
 *   for committed candidates its snapshot does not see.
 * - A job, after the event's commit, takes the same lock and looks for waits whose snapshot does not
 *   see the candidate.
 *
 * An event committed before the wait began is visible in its snapshot and never resolves it; one
 * committed after is seen by the registration's check (committed before it) or by the job (which waits
 * for the registration's lock, then sees its row), so one side resolves it and none is lost. The lock
 * is taken only in the engine's own transactions, and never while holding what a domain path wants.
 *
 * The plan evaluates a filter when the step resumes and puts a non-matching wait back. Here the filter
 * is evaluated at the match, under the lock, and a non-matching event leaves the wait `waiting`: a step
 * that left `waiting` for an event that then fails its filter would miss a matching event committed
 * meanwhile, because the job for that event found no waiting step.
 */
import {
  appendWorkflowJournal,
  enterWorkflowWait,
  getEventCause,
  getWaitCandidate,
  getWorkflowRun,
  hasWorkflowWaitIndex,
  insertWorkflowWaitCandidate,
  listUnseenWaitCandidates,
  listWaitsForCandidate,
  markWaitCandidateProcessed,
  recordWorkflowWaitIndex,
  resolveWorkflowWait,
  takeWorkflowCorrelationLock,
  type Db,
  type WorkflowRunStepRow,
} from '@openverify/db';
import {
  buildTriggerView,
  decideWaitFilter,
  parseCondition,
  runScope,
  type JsonRecord,
  type JsonValue,
  type RunState,
  type TriggerDocument,
} from '@openverify/workflow-engine';
import type { WorkflowWaitMatchJob } from '../../ports.js';
import type { StagedEventFacts } from '../triggers/stage-hook.js';
import type { AdvanceSession } from './advance-run.js';
import { databaseNow, type EngineDeps } from './deps.js';
import { loadRun } from './run-frame.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The ids an event is about: its resource, and what it relates to one to one. */
export function subjectIdsOfPayload(payload: unknown): string[] {
  const data = isRecord(payload) ? payload.data : undefined;
  if (!isRecord(data)) {
    return [];
  }
  const ids = new Set<string>();
  if (typeof data.id === 'string') {
    ids.add(data.id);
  }
  const relationships = isRecord(data.relationships) ? data.relationships : {};
  for (const relationship of Object.values(relationships)) {
    const related = isRecord(relationship) ? relationship.data : undefined;
    if (isRecord(related) && typeof related.id === 'string') {
      ids.add(related.id);
    }
  }
  return [...ids];
}

/** C119.3: in the event's own transaction, with no lock and whatever is waiting. */
export async function recordWaitCandidatesInTx(
  tx: Db,
  event: StagedEventFacts,
): Promise<WorkflowWaitMatchJob[]> {
  const { environmentId, eventId, name } = event;
  if (!(await hasWorkflowWaitIndex(tx, environmentId, name))) {
    return [];
  }
  await insertWorkflowWaitCandidate(tx, {
    eventId,
    environmentId,
    eventName: name,
    subjectIds: subjectIdsOfPayload(event.payload),
  });
  return [{ environmentId, eventId }];
}

/** C119.2: `due_at` from the database clock. */
export async function enterTimeWaitInTx(
  session: AdvanceSession,
  row: WorkflowRunStepRow,
  seconds: number,
): Promise<void> {
  const { tx, loaded, now, after } = session;
  const { environmentId, id: runId } = loaded.run;
  const dueAt = new Date(now.getTime() + seconds * 1_000);
  await enterWorkflowWait(tx, environmentId, { stepId: row.id, dueAt });
  session.journal.push({
    runId,
    kind: 'wait_started',
    stepId: row.id,
    nodeId: row.nodeId,
    iterationPath: row.iterationPath,
  });
  if (seconds * 1_000 <= TIMER_HORIZON_MS) {
    after.wakes.push({
      job: { environmentId, runId, stepId: row.id, attempt: row.attempt + 1 },
      delayMs: seconds * 1_000,
    });
  }
}

/** C117.9: a delayed job only within the hour; the sweep adds the rest as they enter it. */
export const TIMER_HORIZON_MS = 3_600_000;

export interface EventWait {
  readonly correlationKey: string;
  readonly events: readonly string[];
  readonly timeoutSeconds: number;
  readonly filter: JsonValue;
  readonly onNull: string | null;
  /** Fences an action's own wait to its claim. */
  readonly claimedBy?: string;
  /** K8-6: an action's wait sees from before the action's read, not from its registration. */
  readonly snapshot?: string;
}

/** C119.3: the event as a wait's filter reads it. */
function withEvent(state: RunState, iterationPath: string, payload: unknown) {
  const scope = runScope(state, iterationPath);
  const event: JsonRecord =
    isRecord(payload) && isRecord(payload.data)
      ? buildTriggerView(payload as unknown as TriggerDocument)
      : {};
  return { ...scope, roots: { ...scope.roots, event } };
}

/** `error` still resolves the step, which then fails with the code when it is claimed. */
export function filterDecision(
  step: Pick<WorkflowRunStepRow, 'waitFilter' | 'waitFilterOnNull' | 'iterationPath'>,
  state: RunState,
  payload: unknown,
): ReturnType<typeof decideWaitFilter> {
  const filter = step.waitFilter as JsonValue | null;
  if (filter === null) {
    return { kind: 'accept' };
  }
  const parsed = parseCondition(filter);
  if (!parsed.ok) {
    return { kind: 'error', code: 'execution_error' };
  }
  return decideWaitFilter(
    parsed.expression,
    step.waitFilterOnNull,
    withEvent(state, step.iterationPath, payload),
  );
}

/** C119.3: registers the wait, and resolves it at once if an event got there first. */
export async function enterEventWaitInTx(
  session: AdvanceSession,
  row: WorkflowRunStepRow,
  wait: EventWait,
): Promise<void> {
  const { tx, loaded, now, after } = session;
  const { environmentId, id: runId, workflowVersionId } = loaded.run;
  // Before any step row: a job holding this lock writes step rows and wants nothing a run holds.
  await takeWorkflowCorrelationLock(tx, environmentId, wait.correlationKey);
  const entered = await enterWorkflowWait(tx, environmentId, {
    stepId: row.id,
    timeoutAt: new Date(now.getTime() + wait.timeoutSeconds * 1_000),
    eventNames: wait.events,
    correlationKey: wait.correlationKey,
    filter: wait.filter as never,
    filterOnNull: wait.onNull,
    ...(wait.claimedBy === undefined ? {} : { claimedBy: wait.claimedBy }),
    ...(wait.snapshot === undefined ? {} : { snapshot: wait.snapshot }),
  });
  if (entered === null) {
    return;
  }
  // A draft's test run, or an action's own wait: publish recorded neither.
  await recordWorkflowWaitIndex(tx, environmentId, workflowVersionId, wait.events);
  session.journal.push({
    runId,
    kind: 'wait_started',
    stepId: row.id,
    nodeId: row.nodeId,
    iterationPath: row.iterationPath,
  });
  for (const candidate of await listUnseenWaitCandidates(tx, environmentId, row.id)) {
    const event = await getEventCause(tx, environmentId, candidate.eventId);
    const decision = filterDecision(entered, loaded.state, event?.payload ?? null);
    if (decision.kind !== 'keep-waiting') {
      const resolved = await resolveWorkflowWait(tx, environmentId, row.id, candidate.eventId);
      if (resolved !== null) {
        session.journal.push({
          runId,
          kind: 'wait_resolved',
          stepId: row.id,
          nodeId: row.nodeId,
          iterationPath: row.iterationPath,
        });
        after.environments.add(environmentId);
      }
      return;
    }
  }
}

/** One key of one candidate, under its lock. */
async function matchKey(
  db: Db,
  environmentId: string,
  key: string,
  candidate: { eventId: string; eventName: string; xact: string },
  payload: unknown,
): Promise<number> {
  return db.transaction(async (tx) => {
    await takeWorkflowCorrelationLock(tx, environmentId, key);
    const waits = await listWaitsForCandidate(tx, environmentId, key, candidate);
    let resolved = 0;
    const now = await databaseNow(tx);
    for (const wait of waits) {
      const decision =
        wait.waitFilter === null
          ? ({ kind: 'accept' } as const)
          : await decideForWait(tx, wait, payload, now);
      if (decision === 'gone') {
        continue;
      }
      if (decision.kind === 'keep-waiting') {
        await appendWorkflowJournal(tx, environmentId, [
          {
            runId: wait.runId,
            kind: 'wait_restored',
            stepId: wait.id,
            nodeId: wait.nodeId,
            iterationPath: wait.iterationPath,
          },
        ]);
        continue;
      }
      const row = await resolveWorkflowWait(tx, environmentId, wait.id, candidate.eventId);
      if (row !== null) {
        resolved += 1;
        await appendWorkflowJournal(tx, environmentId, [
          {
            runId: wait.runId,
            kind: 'wait_resolved',
            stepId: wait.id,
            nodeId: wait.nodeId,
            iterationPath: wait.iterationPath,
          },
        ]);
      }
    }
    return resolved;
  });
}

async function decideForWait(tx: Db, wait: WorkflowRunStepRow, payload: unknown, now: Date) {
  const run = await getWorkflowRun(tx, wait.environmentId, wait.runId);
  if (run?.status !== 'in_progress') {
    return 'gone' as const;
  }
  const loaded = await loadRun(tx, run, now);
  return filterDecision(wait, loaded.state, payload);
}

/** C119.3: what the job and the sweep do for one candidate. */
export async function matchWaitCandidate(
  deps: EngineDeps,
  job: WorkflowWaitMatchJob,
): Promise<boolean> {
  const { db } = deps;
  const { environmentId, eventId } = job;
  const candidate = await getWaitCandidate(db, environmentId, eventId);
  if (candidate?.processedAt !== null) {
    return false;
  }
  const event = await getEventCause(db, environmentId, eventId);
  let resolved = 0;
  for (const key of candidate.subjectIds) {
    resolved += await matchKey(db, environmentId, key, candidate, event?.payload ?? null);
  }
  await markWaitCandidateProcessed(db, environmentId, eventId, await databaseNow(db));
  return resolved > 0;
}
