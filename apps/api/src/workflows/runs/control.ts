/**
 * C120.3-C120.5, C116.2: what an operator does to a run. Each works under the run's lock, so it can
 * never interleave with an advance, and a cancel fences out what is running: the step's claim goes, so
 * its completion finds nothing (C117.3), and an effect in a transaction rolls back with it.
 */
import type { WorkflowRunStatus } from '@openverify/core';
import {
  appendWorkflowJournal,
  cancelWorkflowRunSteps,
  endWorkflowRun,
  latestPublishedWorkflowRunVersion,
  listChildWorkflowRuns,
  listUnfinishedRunsBeforeVersion,
  listWorkflowRunEffects,
  lockWorkflowRun,
  openWorkflowRunValues,
  readDefinitionVersionNumber,
  reopenWorkflowRun,
  type Db,
  type WorkflowRunRow,
} from '@openverify/db';
import type { JsonRecord, JsonValue } from '@openverify/workflow-engine';
import { requirePiiView } from '../../auth/pii.js';
import { NotFoundError, WorkflowProblemError } from '../../errors.js';
import { authorizePrincipal } from '../../plugins/principal-auth.js';
import type { Permission } from '@openverify/core';
import type { WorkflowActing } from '../acting.js';
import type { RunGrant } from '../engine/action-port.js';
import {
  applyCompletion,
  emptyAfterCommit,
  flushAfterCommit,
  openSession,
  releaseEarlierRunWaiters,
  type AfterCommit,
} from '../engine/advance-run.js';
import { grantOf } from '../engine/authority.js';
import { databaseNow, type EngineDeps } from '../engine/deps.js';
import { stageRunEnd, stageRunEvent } from '../engine/run-events.js';
import { definitionOf, frameOf, loadRun } from '../engine/run-frame.js';
import { startWorkflowRunInTx } from '../engine/start-run.js';

const notFound = (): NotFoundError => new NotFoundError('Workflow run not found.');

/** C121.3: a principal starting a run holds every scope of its grant, and PII when it needs it. */
export function assertHoldsGrant(acting: WorkflowActing, grant: RunGrant): void {
  authorizePrincipal(acting.principal, ['workflows:trigger', ...grant.scopes] as Permission[]);
  if (grant.pii) {
    requirePiiView(acting.principal);
  }
}

/** The run's end by an operator or a parent, under its lock. Children go with it. */
async function cancelLocked(
  tx: Db,
  deps: EngineDeps,
  run: WorkflowRunRow,
  after: AfterCommit,
): Promise<WorkflowRunRow | null> {
  const { environmentId, id } = run;
  const at = await databaseNow(tx);
  await cancelWorkflowRunSteps(tx, environmentId, id, { at });
  const ended = await endWorkflowRun(tx, environmentId, id, { status: 'canceled', at });
  if (ended === null) {
    return null;
  }
  await appendWorkflowJournal(tx, environmentId, [{ runId: id, kind: 'run_canceled' }]);
  const definition = await definitionOf(tx, environmentId, run.workflowVersionId);
  const staged = await stageRunEnd(tx, deps.events, ended, definition, []);
  if (staged !== null) {
    after.staged.push(staged);
  }
  for (const child of await listChildWorkflowRuns(tx, environmentId, id)) {
    const locked = await lockWorkflowRun(tx, environmentId, child.id);
    if (locked?.status === 'in_progress') {
      await cancelLocked(tx, deps, locked, after);
    }
  }
  const session = await openSession(tx, deps, await loadRun(tx, ended, at), after);
  await releaseEarlierRunWaiters(session, ended);
  return ended;
}

const NOT_CANCELABLE: ReadonlySet<WorkflowRunStatus> = new Set([
  'completed',
  'errored',
  'canceled',
]);

export async function cancelRun(
  deps: EngineDeps,
  environmentId: string,
  id: string,
  audit: (tx: Db, run: WorkflowRunRow) => Promise<void>,
): Promise<WorkflowRunRow> {
  const after = emptyAfterCommit();
  const ended = await deps.db.transaction(async (tx) => {
    const run = await lockWorkflowRun(tx, environmentId, id);
    if (run === null) {
      throw notFound();
    }
    if (NOT_CANCELABLE.has(run.status)) {
      throw new WorkflowProblemError('run_not_cancelable', 'This run has already ended.');
    }
    const canceled = await cancelLocked(tx, deps, run, after);
    if (canceled === null) {
      throw new WorkflowProblemError('run_not_cancelable', 'This run has already ended.');
    }
    await audit(tx, canceled);
    return canceled;
  });
  await flushAfterCommit(deps, after);
  return ended;
}

/** C116.2: the unfinished runs of versions numbered before `beforeVersionId`. */
export async function cancelRunsBeforeVersion(
  deps: EngineDeps,
  environmentId: string,
  workflowId: string,
  beforeVersionId: string,
  audit: (tx: Db, run: WorkflowRunRow) => Promise<void>,
): Promise<number> {
  const versionNumber = await readDefinitionVersionNumber(deps.db, environmentId, {
    workflowId,
    versionId: beforeVersionId,
  });
  if (versionNumber === null) {
    throw new NotFoundError('Workflow version not found.');
  }
  const runs = await listUnfinishedRunsBeforeVersion(deps.db, environmentId, {
    workflowId,
    versionNumber,
  });
  let canceled = 0;
  for (const { id } of runs) {
    const after = emptyAfterCommit();
    const ended = await deps.db.transaction(async (tx) => {
      const run = await lockWorkflowRun(tx, environmentId, id);
      if (run?.status !== 'in_progress') {
        return null;
      }
      const done = await cancelLocked(tx, deps, run, after);
      if (done !== null) {
        await audit(tx, done);
      }
      return done;
    });
    await flushAfterCommit(deps, after);
    canceled += ended === null ? 0 : 1;
  }
  return canceled;
}

const notResumable = (detail: string, members: Record<string, string>): WorkflowProblemError =>
  new WorkflowProblemError('run_not_resumable', detail, { members });

/** C120.3: what keeps this run from resuming, as a problem naming it. */
async function assertResumable(
  tx: Db,
  run: WorkflowRunRow,
  failures: readonly { nodeId: string | null }[],
  skipUnknown: boolean,
): Promise<string[]> {
  if (run.status !== 'errored') {
    throw notResumable('Only an errored run resumes.', { 'blocked-by': 'not_errored' });
  }
  if (run.errorCode === 'publisher_revoked') {
    throw notResumable('A run stopped by its publisher’s rights can only be rerun.', {
      'blocked-by': 'publisher_revoked',
    });
  }
  if (run.redactedAt !== null || run.valuesPurgedAt !== null) {
    throw notResumable('This run’s values are gone.', { 'blocked-by': 'values_gone' });
  }
  if (failures.length === 0 || failures.some(({ nodeId }) => nodeId === null)) {
    throw notResumable('This run stopped as a whole, at a limit.', {
      'blocked-by': run.errorCode ?? 'run_failure',
    });
  }
  const effects = await listWorkflowRunEffects(tx, run.environmentId, run.id);
  const unknown = effects.filter(({ status }) => status === 'unknown');
  const [first] = unknown;
  if (first !== undefined && !skipUnknown) {
    throw notResumable('A step’s effect is unknown; acknowledge it to go on.', {
      'blocked-by': 'unknown_effect',
      'step-id': first.stepId,
    });
  }
  return unknown.map(({ effectKey }) => effectKey);
}

export interface ResumeOptions {
  skipUnknownEffects: boolean;
  audit: (tx: Db, run: WorkflowRunRow, acknowledged: readonly string[]) => Promise<void>;
}

export async function resumeRun(
  deps: EngineDeps,
  environmentId: string,
  id: string,
  options: ResumeOptions,
): Promise<WorkflowRunRow> {
  const after = emptyAfterCommit();
  const resumed = await deps.db.transaction(async (tx) => {
    const run = await lockWorkflowRun(tx, environmentId, id);
    if (run === null) {
      throw notFound();
    }
    const { failures } = frameOf(openWorkflowRunValues(run).variables);
    const acknowledged = await assertResumable(tx, run, failures, options.skipUnknownEffects);
    const reopened = await reopenWorkflowRun(tx, environmentId, id);
    if (reopened === null) {
      throw notResumable('Only an errored run resumes.', { 'blocked-by': 'not_errored' });
    }
    const now = await databaseNow(tx);
    const loaded = await loadRun(tx, reopened, now);
    loaded.frame = {
      ...loaded.frame,
      acknowledged: [...loaded.frame.acknowledged, ...acknowledged],
    };
    const session = await openSession(tx, deps, loaded, after);
    session.journal.push({ runId: id, kind: 'run_resumed' });
    after.staged.push(
      await stageRunEvent(tx, deps.events, reopened, 'workflow-run.resumed', loaded.definition),
    );
    await applyCompletion(session, { kind: 'resume' });
    await options.audit(tx, reopened, acknowledged);
    return reopened;
  });
  await flushAfterCommit(deps, after);
  return resumed;
}

/** C120.4: the latest published version, the same snapshot and inputs, linked by `rerun-of`. */
export async function rerunRun(
  deps: EngineDeps,
  acting: WorkflowActing,
  id: string,
  audit: (tx: Db, run: WorkflowRunRow) => Promise<void>,
): Promise<WorkflowRunRow> {
  const { environmentId } = acting.ctx;
  const after: { value: AfterCommit | null } = { value: null };
  const run = await deps.db.transaction(async (tx) => {
    const source = await lockWorkflowRun(tx, environmentId, id);
    if (source === null) {
      throw notFound();
    }
    const values = openWorkflowRunValues(source);
    if (values.inputs === null) {
      throw notResumable('This run’s values are gone.', { 'blocked-by': 'values_gone' });
    }
    const version = await latestPublishedWorkflowRunVersion(tx, environmentId, source.workflowId);
    if (version === null) {
      throw new WorkflowProblemError(
        'workflow_not_running',
        'This workflow has no published version.',
      );
    }
    const grant = grantOf(version.grant ?? {});
    assertHoldsGrant(acting, grant);
    const started = await startWorkflowRunInTx(tx, deps, {
      environmentId,
      workflowId: source.workflowId,
      workflowVersionId: version.id,
      triggerType: source.triggerType,
      creator: acting.actor,
      trigger: values.triggerSnapshot as JsonValue,
      inputs: values.inputs as JsonRecord,
      subjectIds: [],
      causedByPrincipal: acting.actor.id,
      grant,
      rerunOfId: source.id,
    });
    after.value = started.after;
    await audit(tx, started.run);
    return started.run;
  });
  if (after.value !== null) {
    await flushAfterCommit(deps, after.value);
  }
  return run;
}
