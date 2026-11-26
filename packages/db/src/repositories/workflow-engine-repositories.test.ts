/**
 * C117.2-C117.5, C119.3, C120 (Workflow 8A, `api-engine`): the engine's repositories on a real
 * schema. A claim is conditional and fenced, a journal row holds no value, an effect has one row per
 * key, a run's values are sealed for their row, a run keeps at most 1,000 subjects, and redaction and
 * retention leave nothing behind. Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { SEALED } from '../encrypted-columns.js';
import { openJson } from '../sealed.js';
import { workflowRunSubjects, workflowRuns } from '../schema.js';
import {
  createTestDatabase,
  createTestTenant,
  createdAtClock,
  seedWorkflow,
  seedWorkflowRun,
  seedWorkflowRunFile,
  seedWorkflowRunStep,
  seedWorkflowVersion,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import {
  appendWorkflowJournal,
  claimWorkflowEffect,
  claimWorkflowRunStep,
  completeWorkflowEffect,
  completeWorkflowRunStep,
  countInFlightWorkflowSteps,
  countRunningWorkflowActions,
  createWorkflowRun,
  createWorkflowRunFile,
  createWorkflowRunSteps,
  deleteExpiredWorkflowRunSkeletons,
  endWorkflowRun,
  extendWorkflowStepClaim,
  getWorkflowRun,
  getWorkflowRunStep,
  listExpiredWorkflowStepClaims,
  listReadyWorkflowRunSteps,
  listRedactedWorkflowRunFiles,
  listTimedOutWorkflowWaits,
  listWorkflowEffectCopiesOf,
  listWorkflowRunEffects,
  listWorkflowRunFiles,
  listWorkflowRunSteps,
  listWorkflowRuns,
  listWorkflowRunsForSubjects,
  lockWorkflowRun,
  markWorkflowEffectUnknown,
  markWorkflowRunFilesDeleted,
  openWorkflowRunValues,
  openWorkflowStepValues,
  purgeExpiredWorkflowRunValues,
  recordWorkflowRunSubjects,
  redactWorkflowRunFiles,
  redactWorkflowRunValues,
  releaseWorkflowStepClaim,
  saveWorkflowRunState,
  setWorkflowRunWaitingOn,
  touchWorkflowEnvironmentSlot,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const tenant = async () => (await createTestTenant(database.db)).environment.id;

async function seedVersion(environmentId: string) {
  const workflow = await seedWorkflow(database.db, environmentId);
  const version = await seedWorkflowVersion(database.db, environmentId, {
    workflowId: workflow.id,
  });
  return { workflowId: workflow.id, workflowVersionId: version.id };
}

const DEADLINE = new Date('2027-01-01T00:00:00.000Z');

const newRun = (workflow: { workflowId: string; workflowVersionId: string }) => ({
  id: testId('wfr'),
  ...workflow,
  triggerType: 'trigger-api' as const,
  creatorType: 'api-key',
  creatorId: testId('key'),
  deadlineAt: DEADLINE,
  effectiveGrant: { scopes: ['inquiries:write'], pii: false },
  triggerSnapshot: { id: 'inq_1' },
  inputs: { code: 'a' },
  variables: { risk: 1 },
});

describe('runs', () => {
  it('seals a run’s values for its row and reads them back', async () => {
    const environmentId = await tenant();
    const input = newRun(await seedVersion(environmentId));
    const run = await createWorkflowRun(database.db, environmentId, input);

    expect(run.id).toBe(input.id);
    expect(run.status).toBe('in_progress');
    expect(JSON.stringify(run)).not.toContain('inq_1');
    expect(openWorkflowRunValues(run)).toEqual({
      triggerSnapshot: { id: 'inq_1' },
      inputs: { code: 'a' },
      variables: { risk: 1 },
      outputs: null,
    });
  });

  it('answers the run a key already holds, so a repeat starts nothing', async () => {
    const environmentId = await tenant();
    const workflow = await seedVersion(environmentId);
    const first = await createWorkflowRun(database.db, environmentId, {
      ...newRun(workflow),
      idempotencyKey: 'key-1',
    });

    const repeat = await createWorkflowRun(database.db, environmentId, {
      ...newRun(workflow),
      idempotencyKey: 'key-1',
    });

    expect(repeat.id).toBe(first.id);
  });

  it('finds a run only in its own environment (C121.6)', async () => {
    const environmentId = await tenant();
    const other = await tenant();
    const { id } = await seedWorkflowRun(database.db, environmentId);

    expect((await getWorkflowRun(database.db, environmentId, id))?.id).toBe(id);
    expect(await getWorkflowRun(database.db, other, id)).toBeNull();
    expect(await lockWorkflowRun(database.db, other, id)).toBeNull();
  });

  it('keeps the state beside the variables and counts what ran', async () => {
    const environmentId = await tenant();
    const { id } = await seedWorkflowRun(database.db, environmentId);
    const outcomes = {
      succeeded: 2,
      'failed-continued': 1,
      'timed-out': 0,
      'unknown-effect': 0,
      skipped: 0,
    };

    await saveWorkflowRunState(database.db, environmentId, id, {
      variables: { risk: 2 },
      stepExecutions: 3,
      stepOutcomes: outcomes,
    });

    const run = await getWorkflowRun(database.db, environmentId, id);
    expect(run?.stepExecutions).toBe(3);
    expect(run?.stepOutcomes).toEqual(outcomes);
    expect(run?.hasStepErrors).toBe(true);
    expect(run === null ? null : openWorkflowRunValues(run).variables).toEqual({ risk: 2 });
  });

  it('ends a run once, with its error codes and sealed outputs', async () => {
    const environmentId = await tenant();
    const { id } = await seedWorkflowRun(database.db, environmentId);
    await setWorkflowRunWaitingOn(database.db, environmentId, id, 'event');
    const at = new Date('2026-11-02T00:00:00.000Z');

    const ended = await endWorkflowRun(database.db, environmentId, id, {
      status: 'errored',
      errorType: 'resource-error',
      errorCode: 'wait_timed_out',
      errorNodeId: 'wait_for_it',
      outputs: { decision: 'none' },
      at,
    });
    const again = await endWorkflowRun(database.db, environmentId, id, { status: 'completed', at });

    expect(ended?.status).toBe('errored');
    expect(ended?.waitingOn).toBeNull();
    expect(ended?.completedAt).toEqual(at);
    expect(ended === null ? null : openWorkflowRunValues(ended).outputs).toEqual({
      decision: 'none',
    });
    expect(again).toBeNull();
  });

  it('lists newest first with every filter', async () => {
    const environmentId = await tenant();
    const clock = createdAtClock(database.db);
    onTestFinished(wallClockStepsBack());
    const workflow = await seedVersion(environmentId);
    const older = await clock.stamp(
      'workflow_runs',
      await seedWorkflowRun(database.db, environmentId, workflow),
    );
    const newer = await clock.stamp(
      'workflow_runs',
      await seedWorkflowRun(database.db, environmentId, { ...workflow, status: 'completed' }),
    );
    const elsewhere = await clock.stamp(
      'workflow_runs',
      await seedWorkflowRun(database.db, environmentId),
    );
    await recordWorkflowRunSubjects(database.db, environmentId, older.id, [
      { subjectId: 'inq_1', source: 'trigger' },
    ]);

    const byWorkflow = await listWorkflowRuns(
      database.db,
      environmentId,
      { workflowIds: [workflow.workflowId] },
      {},
    );
    expect(byWorkflow.items.map(({ id }) => id)).toEqual([newer.id, older.id]);

    const byStatus = await listWorkflowRuns(
      database.db,
      environmentId,
      { statuses: ['completed'] },
      {},
    );
    expect(byStatus.items.map(({ id }) => id)).toEqual([newer.id]);

    const bySubject = await listWorkflowRuns(
      database.db,
      environmentId,
      { subjectIds: ['inq_1'] },
      {},
    );
    expect(bySubject.items.map(({ id }) => id)).toEqual([older.id]);

    const byVersion = await listWorkflowRuns(
      database.db,
      environmentId,
      { workflowVersionIds: [workflow.workflowVersionId] },
      { size: 1 },
    );
    expect(byVersion.items.map(({ id }) => id)).toEqual([newer.id]);
    expect(byVersion.next).toBe(newer.id);

    const all = await listWorkflowRuns(database.db, environmentId, {}, {});
    expect(all.items.map(({ id }) => id)).toEqual([elsewhere.id, newer.id, older.id]);

    await database.db
      .update(workflowRuns)
      .set({ hasStepErrors: true })
      .where(eq(workflowRuns.id, older.id));
    const withErrors = await listWorkflowRuns(
      database.db,
      environmentId,
      { hasStepErrors: true },
      {},
    );
    expect(withErrors.items.map(({ id }) => id)).toEqual([older.id]);
  });
});

describe('the journal', () => {
  it('appends rows with no value, and refuses a change', async () => {
    const environmentId = await tenant();
    const { id } = await seedWorkflowRun(database.db, environmentId);

    await appendWorkflowJournal(database.db, environmentId, [
      { runId: id, kind: 'run_created' },
      { runId: id, kind: 'step_failed', nodeId: 'a', attempt: 2, errorType: 'unknown-error' },
    ]);
    await appendWorkflowJournal(database.db, environmentId, []);

    const rows = await database.client.query<{ kind: string; attempt: number | null }>(
      'select kind, attempt from workflow_run_journal where run_id = $1 order by id',
      [id],
    );
    expect(rows.rows).toEqual([
      { kind: 'run_created', attempt: null },
      { kind: 'step_failed', attempt: 2 },
    ]);
    await expect(
      database.client.query('update workflow_run_journal set attempt = 3 where run_id = $1', [id]),
    ).rejects.toThrow();
  });
});

describe('subjects', () => {
  it('keeps each id once and stops at 1,000, marking the overflow (C120.9)', async () => {
    const environmentId = await tenant();
    const { id } = await seedWorkflowRun(database.db, environmentId);

    await recordWorkflowRunSubjects(
      database.db,
      environmentId,
      id,
      Array.from({ length: 1_000 }, (_item, index) => ({
        subjectId: `inq_${String(index)}`,
        source: 'read' as const,
      })),
    );
    await recordWorkflowRunSubjects(database.db, environmentId, id, [
      { subjectId: 'inq_0', source: 'written' },
    ]);
    const before = await getWorkflowRun(database.db, environmentId, id);
    expect(before?.subjectsOverflow).toBe(false);

    await recordWorkflowRunSubjects(database.db, environmentId, id, [
      { subjectId: 'inq_one_more', source: 'output' },
    ]);

    const after = await getWorkflowRun(database.db, environmentId, id);
    const rows = await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowRunSubjects)
      .where(eq(workflowRunSubjects.runId, id));
    expect(after?.subjectsOverflow).toBe(true);
    expect(rows[0]?.count).toBe(1_000);
  });

  it('finds the runs of a subject, and every overflowed run of the environment (P33)', async () => {
    const environmentId = await tenant();
    const named = await seedWorkflowRun(database.db, environmentId);
    const overflowed = await seedWorkflowRun(database.db, environmentId);
    const unrelated = await seedWorkflowRun(database.db, environmentId);
    await recordWorkflowRunSubjects(database.db, environmentId, named.id, [
      { subjectId: 'inq_a', source: 'trigger' },
    ]);
    await database.db
      .update(workflowRuns)
      .set({ subjectsOverflow: true })
      .where(eq(workflowRuns.id, overflowed.id));

    const found = await listWorkflowRunsForSubjects(database.db, environmentId, ['inq_a']);

    expect(found.map(({ id }) => id).sort()).toEqual([named.id, overflowed.id].sort());
    expect(found.map(({ id }) => id)).not.toContain(unrelated.id);
  });
});

async function seedRunAndStep(environmentId: string, status = 'ready') {
  const run = await seedWorkflowRun(database.db, environmentId);
  const [step] = await createWorkflowRunSteps(database.db, environmentId, [
    {
      id: testId('wfst'),
      runId: run.id,
      nodeId: 'send',
      iterationPath: '',
      nodeType: 'action',
      actionKey: 'tag_object',
      actionVersion: 1,
      status: status as 'ready',
      input: { secret: 'a template' },
    },
  ]);
  if (step === undefined) {
    throw new Error('no step');
  }
  return { run, step };
}

const claimOf = (stepId: string, claimedBy: string, claimedUntil: Date) => ({
  stepId,
  claimedBy,
  claimedUntil,
});

describe('steps', () => {
  it('claims a ready step once, attempt and claims going up', async () => {
    const environmentId = await tenant();
    const { step } = await seedRunAndStep(environmentId);
    const until = new Date('2026-11-02T00:01:00.000Z');

    const first = await claimWorkflowRunStep(
      database.db,
      environmentId,
      claimOf(step.id, 'token-a', until),
    );
    const second = await claimWorkflowRunStep(
      database.db,
      environmentId,
      claimOf(step.id, 'token-b', until),
    );

    expect(first?.status).toBe('running');
    expect(first?.attempt).toBe(1);
    expect(first?.claims).toBe(1);
    expect(first?.claimedBy).toBe('token-a');
    expect(second).toBeNull();
  });

  it('fences a completion by its token, and a lost claim changes nothing', async () => {
    const environmentId = await tenant();
    const { step } = await seedRunAndStep(environmentId);
    const until = new Date('2026-11-02T00:01:00.000Z');
    const at = new Date('2026-11-02T00:00:30.000Z');
    await claimWorkflowRunStep(database.db, environmentId, claimOf(step.id, 'token-a', until));

    const lost = await completeWorkflowRunStep(database.db, environmentId, {
      stepId: step.id,
      claimedBy: 'token-b',
      status: 'succeeded',
      output: { not: 'mine' },
      at,
    });
    const won = await completeWorkflowRunStep(database.db, environmentId, {
      stepId: step.id,
      claimedBy: 'token-a',
      status: 'succeeded',
      output: { tag: 'mine' },
      at,
    });

    expect(lost).toBeNull();
    expect(won?.status).toBe('succeeded');
    expect(won?.claimedBy).toBeNull();
    expect(won === null ? null : openWorkflowStepValues(won).output).toEqual({
      tag: 'mine',
    });
  });

  it('extends a claim only while it is held, and releases it with a due time', async () => {
    const environmentId = await tenant();
    const { step } = await seedRunAndStep(environmentId);
    const until = new Date('2026-11-02T00:01:00.000Z');
    const later = new Date('2026-11-02T00:02:00.000Z');
    await claimWorkflowRunStep(database.db, environmentId, claimOf(step.id, 'token-a', until));

    expect(
      await extendWorkflowStepClaim(database.db, environmentId, claimOf(step.id, 'token-b', later)),
    ).toBe(false);
    expect(
      await extendWorkflowStepClaim(database.db, environmentId, claimOf(step.id, 'token-a', later)),
    ).toBe(true);
    expect((await getWorkflowRunStep(database.db, environmentId, step.id))?.claimedUntil).toEqual(
      later,
    );

    const released = await releaseWorkflowStepClaim(database.db, environmentId, {
      stepId: step.id,
      claimedBy: 'token-a',
      dueAt: later,
    });

    expect(released?.status).toBe('ready');
    expect(released?.claimedBy).toBeNull();
    expect(released?.dueAt).toEqual(later);
    expect(released?.enqueuedAt).toBeNull();
  });

  it('lists what is ready and due, skips what another sweep holds, and stamps nothing', async () => {
    const environmentId = await tenant();
    const { step } = await seedRunAndStep(environmentId);
    const { step: later } = await seedRunAndStep(environmentId);
    const now = new Date('2026-11-02T00:00:00.000Z');
    await database.client.query('update workflow_run_steps set due_at = $2 where id = $1', [
      later.id,
      new Date('2026-11-02T00:10:00.000Z').toISOString(),
    ]);

    const ready = await listReadyWorkflowRunSteps(database.db, { limit: 100, now, environmentId });

    expect(ready.map(({ id }) => id)).toEqual([step.id]);
  });

  it('lists a running step past its lease, and a wait past its timeout', async () => {
    const environmentId = await tenant();
    const { step } = await seedRunAndStep(environmentId);
    const { step: wait } = await seedRunAndStep(environmentId, 'waiting');
    const past = new Date('2026-11-02T00:00:00.000Z');
    const now = new Date('2026-11-02T00:05:00.000Z');
    await claimWorkflowRunStep(database.db, environmentId, claimOf(step.id, 'token-a', past));
    await database.client.query('update workflow_run_steps set timeout_at = $2 where id = $1', [
      wait.id,
      past.toISOString(),
    ]);

    expect(
      (await listExpiredWorkflowStepClaims(database.db, { limit: 100, now, environmentId })).map(
        ({ id }) => id,
      ),
    ).toEqual([step.id]);
    expect(
      (await listTimedOutWorkflowWaits(database.db, { limit: 100, now, environmentId })).map(
        ({ id }) => id,
      ),
    ).toEqual([wait.id]);
  });

  it('counts what is running or enqueued, and running steps by action', async () => {
    const environmentId = await tenant();
    const { step } = await seedRunAndStep(environmentId);
    await seedRunAndStep(environmentId);
    const { step: enqueued } = await seedRunAndStep(environmentId);
    await database.client.query('update workflow_run_steps set enqueued_at = now() where id = $1', [
      enqueued.id,
    ]);
    await claimWorkflowRunStep(
      database.db,
      environmentId,
      claimOf(step.id, 'token-a', new Date('2026-11-02T00:01:00.000Z')),
    );

    expect(await countInFlightWorkflowSteps(database.db, environmentId)).toBe(2);
    expect(await countRunningWorkflowActions(database.db, environmentId)).toEqual({
      tag_object: 1,
    });
  });

  it('lists a run’s steps newest first in pages', async () => {
    const environmentId = await tenant();
    const run = await seedWorkflowRun(database.db, environmentId);
    const clock = createdAtClock(database.db);
    onTestFinished(wallClockStepsBack());
    await clock.stamp(
      'workflow_run_steps',
      await seedWorkflowRunStep(database.db, environmentId, { runId: run.id, nodeId: 'a' }),
    );
    const second = await clock.stamp(
      'workflow_run_steps',
      await seedWorkflowRunStep(database.db, environmentId, { runId: run.id, nodeId: 'b' }),
    );

    const page = await listWorkflowRunSteps(database.db, environmentId, run.id, { size: 1 });

    expect(page.items.map(({ id }) => id)).toEqual([second.id]);
    expect(page.next).toBe(second.id);
  });
});

describe('effects', () => {
  it('claims one row per key, and a repeat finds it', async () => {
    const environmentId = await tenant();
    const { run, step } = await seedRunAndStep(environmentId);
    const input = {
      id: testId('wfef'),
      runId: run.id,
      stepId: step.id,
      effectKey: `${run.id}/send/`,
      kind: 'send_email',
    };

    const first = await claimWorkflowEffect(database.db, environmentId, input);
    const repeat = await claimWorkflowEffect(database.db, environmentId, {
      ...input,
      id: testId('wfef'),
    });

    expect(first.claimed).toBe(true);
    expect(first.effect.status).toBe('claimed');
    expect(repeat.claimed).toBe(false);
    expect(repeat.effect.id).toBe(first.effect.id);
  });

  it('seals a done effect’s result, records a copy, and finds it by source', async () => {
    const environmentId = await tenant();
    const { run, step } = await seedRunAndStep(environmentId);
    const effectKey = `${run.id}/copy/`;
    await claimWorkflowEffect(database.db, environmentId, {
      id: testId('wfef'),
      runId: run.id,
      stepId: step.id,
      effectKey,
      kind: 'update_object',
    });

    const done = await completeWorkflowEffect(
      database.db,
      environmentId,
      effectKey,
      { outcome: 'applied' },
      { targetId: 'acc_target', sourceSubjectIds: ['inq_source'] },
    );

    expect(done?.status).toBe('done');
    expect(done?.resultSealed).not.toContain('applied');
    expect(
      done?.resultSealed == null
        ? null
        : openJson(SEALED.workflowEffectResult, done.id, done.resultSealed),
    ).toEqual({ outcome: 'applied' });
    const copies = await listWorkflowEffectCopiesOf(database.db, environmentId, ['inq_source']);
    expect(copies.map(({ copyTargetId }) => copyTargetId)).toEqual(['acc_target']);
    expect(await listWorkflowEffectCopiesOf(database.db, environmentId, ['inq_none'])).toEqual([]);
  });

  it('marks a claimed effect unknown, never a done one', async () => {
    const environmentId = await tenant();
    const { run, step } = await seedRunAndStep(environmentId);
    const effectKey = `${run.id}/mail/`;
    await claimWorkflowEffect(database.db, environmentId, {
      id: testId('wfef'),
      runId: run.id,
      stepId: step.id,
      effectKey,
      kind: 'send_email',
    });

    const unknown = await markWorkflowEffectUnknown(database.db, environmentId, effectKey);
    await completeWorkflowEffect(database.db, environmentId, effectKey, { delivery: 'accepted' });
    const done = await markWorkflowEffectUnknown(database.db, environmentId, effectKey);

    expect(unknown?.status).toBe('unknown');
    expect(done).toBeNull();
    expect(
      (await listWorkflowRunEffects(database.db, environmentId, run.id)).map(
        ({ status }) => status,
      ),
    ).toEqual(['done']);
  });
});

describe('trigger files', () => {
  it('keeps a file’s name sealed and drops its key and name on redaction', async () => {
    const environmentId = await tenant();
    const run = await seedWorkflowRun(database.db, environmentId);
    const id = testId('wfrf');
    const file = await createWorkflowRunFile(database.db, environmentId, {
      id,
      runId: run.id,
      storageKey: `workflow-run-files/${id}`,
      wrappedDek: 'wrapped',
      filename: 'synthetic-name.png',
      mimeType: 'image/png',
      byteSize: 9,
      sha256: 'a'.repeat(64),
    });
    expect(file.filenameSealed).not.toContain('synthetic-name');
    expect((await listWorkflowRunFiles(database.db, environmentId, run.id)).length).toBe(1);

    const at = new Date('2026-11-02T00:00:00.000Z');
    await redactWorkflowRunFiles(database.db, environmentId, run.id, at);

    const [redacted] = await listWorkflowRunFiles(database.db, environmentId, run.id);
    expect(redacted?.wrappedDek).toBeNull();
    expect(redacted?.filenameSealed).toBeNull();
    expect(redacted?.redactedAt).toEqual(at);
    expect(
      (await listRedactedWorkflowRunFiles(database.db, { limit: 500 })).map((row) => row.id),
    ).toContain(id);

    await markWorkflowRunFilesDeleted(database.db, [id], at);

    expect(
      (await listRedactedWorkflowRunFiles(database.db, { limit: 500 })).map((row) => row.id),
    ).not.toContain(id);
  });
});

describe('redaction and retention', () => {
  async function seedFullRun(
    environmentId: string,
    status: 'in_progress' | 'completed' = 'completed',
  ) {
    const completedAt = new Date('2026-01-01T00:00:00.000Z');
    const run = await seedWorkflowRun(database.db, environmentId, {
      status,
      ...(status === 'completed' ? { completedAt } : {}),
      triggerSnapshot: { marker: 'marker-value' },
      inputs: { marker: 'marker-value' },
      variables: { marker: 'marker-value' },
      outputs: { marker: 'marker-value' },
    });
    const step = await seedWorkflowRunStep(database.db, environmentId, {
      runId: run.id,
      status: 'succeeded',
      input: { marker: 'marker-value' },
      output: { marker: 'marker-value' },
      console: ['marker-value'],
    });
    await claimWorkflowEffect(database.db, environmentId, {
      id: testId('wfef'),
      runId: run.id,
      stepId: step.id,
      effectKey: `${run.id}/run_report/`,
      kind: 'tag_object',
    });
    await completeWorkflowEffect(database.db, environmentId, `${run.id}/run_report/`, {
      marker: 'marker-value',
    });
    await seedWorkflowRunFile(database.db, environmentId, { runId: run.id });
    return run;
  }

  const stillSealed = async (runId: string) => {
    const runs = await database.client.query<Record<string, string | null>>(
      `select trigger_snapshot, inputs, variables, outputs from workflow_runs where id = $1`,
      [runId],
    );
    const steps = await database.client.query<Record<string, string | null>>(
      `select input, output, console from workflow_run_steps where run_id = $1`,
      [runId],
    );
    const effects = await database.client.query<Record<string, string | null>>(
      `select result from workflow_step_effects where run_id = $1`,
      [runId],
    );
    return [...runs.rows, ...steps.rows, ...effects.rows].flatMap((row) =>
      Object.values(row).filter((value) => value !== null),
    );
  };

  it('nulls every sealed column of one run, and says so once', async () => {
    const environmentId = await tenant();
    const run = await seedFullRun(environmentId);
    expect((await stillSealed(run.id)).length).toBeGreaterThan(0);
    const at = new Date('2026-11-02T00:00:00.000Z');

    expect(await redactWorkflowRunValues(database.db, environmentId, run.id, at)).toBe(true);
    expect(await redactWorkflowRunValues(database.db, environmentId, run.id, at)).toBe(false);

    expect(await stillSealed(run.id)).toEqual([]);
    expect((await getWorkflowRun(database.db, environmentId, run.id))?.redactedAt).toEqual(at);
  });

  it('purges an ended run’s values past the window, and only those', async () => {
    const environmentId = await tenant();
    const old = await seedFullRun(environmentId);
    const live = await seedFullRun(environmentId, 'in_progress');

    const purged = await purgeExpiredWorkflowRunValues(database.db, {
      limit: 500,
      now: new Date('2026-11-02T00:00:00.000Z'),
    });

    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await stillSealed(old.id)).toEqual([]);
    const purgedRun = await getWorkflowRun(database.db, environmentId, old.id);
    expect(purgedRun?.valuesPurgedAt).not.toBeNull();
    expect(await listWorkflowRunFiles(database.db, environmentId, old.id)).toEqual([
      expect.objectContaining({ wrappedDek: null, filenameSealed: null }),
    ]);
    expect((await stillSealed(live.id)).length).toBeGreaterThan(0);
  });

  it('deletes a skeleton past the history window with what hangs off it', async () => {
    const environmentId = await tenant();
    const old = await seedFullRun(environmentId);
    await appendWorkflowJournal(database.db, environmentId, [
      { runId: old.id, kind: 'run_completed' },
    ]);

    const deleted = await deleteExpiredWorkflowRunSkeletons(database.db, {
      limit: 500,
      now: new Date('2027-06-01T00:00:00.000Z'),
    });

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await getWorkflowRun(database.db, environmentId, old.id)).toBeNull();
    const journal = await database.client.query(
      'select id from workflow_run_journal where run_id = $1',
      [old.id],
    );
    expect(journal.rows).toEqual([]);
  });
});

describe('slots', () => {
  it('stamps the rotation, creating the slot once', async () => {
    const environmentId = await tenant();
    const first = new Date('2026-11-02T00:00:00.000Z');
    const second = new Date('2026-11-02T00:00:15.000Z');

    await touchWorkflowEnvironmentSlot(database.db, environmentId, first);
    await touchWorkflowEnvironmentSlot(database.db, environmentId, second);

    // Workflow 11B Stage 1b (P): Phase 8's slot is the workflow-step queue's row of queue_slots.
    const rows = await database.client.query<{ last_served_at: Date }>(
      `select last_served_at from queue_slots where environment_id = $1 and queue = 'workflow-step'`,
      [environmentId],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0]?.last_served_at).toEqual(second);
  });
});
