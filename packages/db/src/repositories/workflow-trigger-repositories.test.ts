/**
 * Workflow 8A, `api-triggers` (C118): the publish-time index, deliveries, schedules, scheduled runs
 * and account actions. Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  createdAtClock,
  seedWorkflow,
  seedWorkflowRun,
  seedWorkflowVersion,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import { InvalidCursorError } from '../errors.js';
import { createEvent } from './events.js';
import { createAccountType } from './accounts.js';
import { updateEnvironmentSettings } from './organizations.js';
import {
  advanceWorkflowSchedule,
  cancelScheduledRunsForSubjects,
  cancelScheduledRunsForWorkflow,
  createAccountAction,
  createScheduledRun,
  createWorkflowDeliveries,
  deferWorkflowDelivery,
  expireWorkflowDeliveries,
  finishScheduledRun,
  finishWorkflowDelivery,
  getAccountAction,
  getWorkflowLiveTarget,
  getWorkflowVersionLiveAt,
  listAccountActions,
  listAccountActionsForType,
  listDueScheduledRuns,
  listDueWorkflowSchedules,
  listEventWorkflowTriggers,
  listPendingWorkflowDeliveries,
  listWorkflowCausalChain,
  listWorkflowDeliveries,
  listWorkflowObjectsAfter,
  lockWorkflowDelivery,
  replaceWorkflowSchedule,
  replaceWorkflowTriggers,
  scheduledRunInputs,
  updateAccountAction,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const tenant = async () => (await createTestTenant(database.db)).environment.id;

const publishedWorkflow = async (environmentId: string) => {
  const workflow = await seedWorkflow(database.db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(database.db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
  });
  return { workflowId: workflow.id, versionId: version.id };
};

const newAccountType = (environmentId: string) =>
  createAccountType(database.db, environmentId, {
    id: testId('acctp'),
    name: `Synthetic ${testId('acctp')}`,
  });

const delivery = (workflowId: string, eventId = testId('evt')) => ({
  id: testId('wftd'),
  eventId,
  eventName: 'inquiry.completed',
  workflowId,
});

describe('the publish-time index (C118.1)', () => {
  it('finds the event triggers of one environment by name, and nothing else', async () => {
    const environmentId = await tenant();
    const other = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    const foreign = await publishedWorkflow(other);
    await replaceWorkflowTriggers(database.db, environmentId, workflowId, [
      { kind: 'trigger-event', eventName: 'inquiry.completed', workflowVersionId: versionId },
      { kind: 'trigger-event', eventName: 'inquiry.approved', workflowVersionId: versionId },
    ]);
    await replaceWorkflowTriggers(database.db, other, foreign.workflowId, [
      {
        kind: 'trigger-event',
        eventName: 'inquiry.completed',
        workflowVersionId: foreign.versionId,
      },
    ]);

    const found = await listEventWorkflowTriggers(database.db, environmentId, 'inquiry.completed');

    expect(found.map((row) => row.workflowId)).toEqual([workflowId]);
    expect(found[0]?.workflowVersionId).toBe(versionId);
    await expect(
      listEventWorkflowTriggers(database.db, environmentId, 'inquiry.failed'),
    ).resolves.toEqual([]);
  });

  it('reads a verification trigger as an event trigger (C118.6)', async () => {
    const environmentId = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    await replaceWorkflowTriggers(database.db, environmentId, workflowId, [
      {
        kind: 'trigger-verification',
        eventName: 'verification.passed',
        workflowVersionId: versionId,
      },
    ]);

    const found = await listEventWorkflowTriggers(
      database.db,
      environmentId,
      'verification.passed',
    );

    expect(found.map((row) => row.kind)).toEqual(['trigger-verification']);
  });

  it('never reads a trigger no event starts', async () => {
    const environmentId = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    await replaceWorkflowTriggers(database.db, environmentId, workflowId, [
      { kind: 'trigger-api', eventName: null, workflowVersionId: versionId },
    ]);

    await expect(
      listEventWorkflowTriggers(database.db, environmentId, 'inquiry.completed'),
    ).resolves.toEqual([]);
  });

  it('replaces a workflow’s rows and leaves another workflow’s alone (C116.1)', async () => {
    const environmentId = await tenant();
    const first = await publishedWorkflow(environmentId);
    const second = await publishedWorkflow(environmentId);
    const old = {
      kind: 'trigger-event',
      eventName: 'inquiry.completed',
    } as const;
    await replaceWorkflowTriggers(database.db, environmentId, first.workflowId, [
      { ...old, workflowVersionId: first.versionId },
    ]);
    await replaceWorkflowTriggers(database.db, environmentId, second.workflowId, [
      { ...old, workflowVersionId: second.versionId },
    ]);

    await replaceWorkflowTriggers(database.db, environmentId, first.workflowId, []);

    const found = await listEventWorkflowTriggers(database.db, environmentId, 'inquiry.completed');
    expect(found.map((row) => row.workflowId)).toEqual([second.workflowId]);
  });

  it('holds a workflow’s filter, which is configuration', async () => {
    const environmentId = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    const filter = { '===': [{ var: 'trigger.status' }, 'completed'] };
    await replaceWorkflowTriggers(database.db, environmentId, workflowId, [
      {
        kind: 'trigger-event',
        eventName: 'inquiry.completed',
        workflowVersionId: versionId,
        filter,
      },
    ]);

    const [row] = await listEventWorkflowTriggers(database.db, environmentId, 'inquiry.completed');

    expect(row?.filter).toEqual(filter);
  });
});

describe('a workflow’s live target (C116.3)', () => {
  it('reads the workflow, its live version and no deployment', async () => {
    const environmentId = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    await database.client.query(
      `update workflows set latest_published_version_id = $1 where id = $2`,
      [versionId, workflowId],
    );

    const target = await getWorkflowLiveTarget(database.db, environmentId, workflowId);

    expect(target?.workflow.id).toBe(workflowId);
    expect(target?.version?.id).toBe(versionId);
    expect(target?.deployment).toBeNull();
  });

  it('reads no version before one is published', async () => {
    const environmentId = await tenant();
    const workflow = await seedWorkflow(database.db, environmentId);

    const target = await getWorkflowLiveTarget(database.db, environmentId, workflow.id);

    expect(target?.version).toBeNull();
  });

  it('reads an active rollout with its versions', async () => {
    const environmentId = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    const treatment = await seedWorkflowVersion(database.db, environmentId, {
      workflowId,
      status: 'published',
      versionNumber: 2,
    });
    const deploymentId = testId('wfd');
    const versions = [
      { token: treatment.id, percentage: 10, label: 'treatment' },
      { token: versionId, percentage: 90, label: 'control' },
    ];
    await database.client.query(
      `insert into workflow_deployments (id, environment_id, workflow_id, versions)
       values ($1, $2, $3, $4::jsonb)`,
      [deploymentId, environmentId, workflowId, JSON.stringify(versions)],
    );
    await database.client.query(
      `update workflows set latest_published_version_id = $1, active_deployment_id = $2
       where id = $3`,
      [versionId, deploymentId, workflowId],
    );

    const target = await getWorkflowLiveTarget(database.db, environmentId, workflowId);

    expect(target?.deployment?.id).toBe(deploymentId);
    expect(target?.deployment?.versions).toEqual(versions);
    expect(target?.versions.map((version) => version.id).sort()).toEqual(
      [treatment.id, versionId].sort(),
    );
  });

  it('never reads another environment’s workflow (C121.6)', async () => {
    const environmentId = await tenant();
    const other = await tenant();
    const { workflowId } = await publishedWorkflow(other);

    await expect(getWorkflowLiveTarget(database.db, environmentId, workflowId)).resolves.toBeNull();
  });

  it('reads the version that was live at a moment, never a draft (C118.1)', async () => {
    const environmentId = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    const later = await seedWorkflowVersion(database.db, environmentId, {
      workflowId,
      status: 'published',
      versionNumber: 2,
    });
    await seedWorkflowVersion(database.db, environmentId, { workflowId, versionNumber: 3 });
    const firstAt = new Date('2026-10-01T00:00:00.000Z');
    const secondAt = new Date('2026-10-02T00:00:00.000Z');
    await database.client.query(`update workflow_versions set published_at = $1 where id = $2`, [
      firstAt.toISOString(),
      versionId,
    ]);
    await database.client.query(`update workflow_versions set published_at = $1 where id = $2`, [
      secondAt.toISOString(),
      later.id,
    ]);

    const at = async (moment: string) =>
      (await getWorkflowVersionLiveAt(database.db, environmentId, workflowId, new Date(moment)))
        ?.id ?? null;

    await expect(at('2026-09-30T00:00:00.000Z')).resolves.toBeNull();
    await expect(at('2026-10-01T12:00:00.000Z')).resolves.toBe(versionId);
    await expect(at('2026-10-03T00:00:00.000Z')).resolves.toBe(later.id);
  });
});

describe('the causal chain (C118.8)', () => {
  it('walks from a run through the events that caused it', async () => {
    const environmentId = await tenant();
    const first = await publishedWorkflow(environmentId);
    const second = await publishedWorkflow(environmentId);
    const third = await publishedWorkflow(environmentId);
    const root = await seedWorkflowRun(database.db, environmentId, {
      workflowId: first.workflowId,
      workflowVersionId: first.versionId,
    });
    const eventOfRoot = testId('evt');
    await createEvent(database.db, environmentId, {
      id: eventOfRoot,
      name: 'inquiry.completed',
      payload: { data: { type: 'inquiry', id: testId('inq') } },
      cause: { runId: root.id },
    });
    const [firstDelivery] = await createWorkflowDeliveries(database.db, environmentId, [
      delivery(second.workflowId, eventOfRoot),
    ]);
    const middle = await seedWorkflowRun(database.db, environmentId, {
      workflowId: second.workflowId,
      workflowVersionId: second.versionId,
    });
    await database.client.query(`update workflow_runs set trigger_delivery_id = $1 where id = $2`, [
      firstDelivery?.id,
      middle.id,
    ]);
    const unrelated = await seedWorkflowRun(database.db, environmentId, {
      workflowId: third.workflowId,
      workflowVersionId: third.versionId,
    });

    const chain = await listWorkflowCausalChain(database.db, environmentId, middle.id);

    expect([...chain].sort()).toEqual([first.workflowId, second.workflowId].sort());
    expect(chain).not.toContain(unrelated.workflowId);
  });

  it('walks a child run back through its parent', async () => {
    const environmentId = await tenant();
    const first = await publishedWorkflow(environmentId);
    const second = await publishedWorkflow(environmentId);
    const parent = await seedWorkflowRun(database.db, environmentId, {
      workflowId: first.workflowId,
      workflowVersionId: first.versionId,
    });
    const child = await seedWorkflowRun(database.db, environmentId, {
      workflowId: second.workflowId,
      workflowVersionId: second.versionId,
    });
    await database.client.query(`update workflow_runs set parent_run_id = $1 where id = $2`, [
      parent.id,
      child.id,
    ]);

    const chain = await listWorkflowCausalChain(database.db, environmentId, child.id);

    expect([...chain].sort()).toEqual([first.workflowId, second.workflowId].sort());
  });

  it('walks a scheduled run back through the run that scheduled it', async () => {
    const environmentId = await tenant();
    const first = await publishedWorkflow(environmentId);
    const second = await publishedWorkflow(environmentId);
    const source = await seedWorkflowRun(database.db, environmentId, {
      workflowId: first.workflowId,
      workflowVersionId: first.versionId,
    });
    const scheduled = await createScheduledRun(database.db, environmentId, {
      id: testId('srrun'),
      targetWorkflowId: second.workflowId,
      sourceRunId: source.id,
      subjectId: null,
      baseAt: new Date(),
      offsetValue: 1,
      offsetUnit: 'minutes',
      offsetDirection: 'after',
      fireAt: new Date(),
      inputs: null,
    });
    const run = await seedWorkflowRun(database.db, environmentId, {
      workflowId: second.workflowId,
      workflowVersionId: second.versionId,
    });
    await database.client.query(`update workflow_runs set scheduled_run_id = $1 where id = $2`, [
      scheduled.id,
      run.id,
    ]);

    const chain = await listWorkflowCausalChain(database.db, environmentId, run.id);

    expect([...chain].sort()).toEqual([first.workflowId, second.workflowId].sort());
  });

  it('reads nothing for a run it cannot find', async () => {
    const environmentId = await tenant();

    await expect(
      listWorkflowCausalChain(database.db, environmentId, testId('wfr')),
    ).resolves.toEqual([]);
  });
});

describe('deliveries (C118.1)', () => {
  it('writes one row per event and workflow, and only the rows it wrote come back', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const first = delivery(workflowId);

    const written = await createWorkflowDeliveries(database.db, environmentId, [first]);
    const repeated = await createWorkflowDeliveries(database.db, environmentId, [
      { ...first, id: testId('wftd') },
    ]);

    expect(written.map((row) => row.id)).toEqual([first.id]);
    expect(written[0]?.status).toBe('pending');
    expect(repeated).toEqual([]);
  });

  it('writes nothing for no deliveries', async () => {
    await expect(createWorkflowDeliveries(database.db, 'env', [])).resolves.toEqual([]);
  });

  it('writes the delivery past the cap as refused, with its reason (C117.7)', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);

    const [row] = await createWorkflowDeliveries(database.db, environmentId, [
      { ...delivery(workflowId), status: 'refused', reasonCode: 'trigger_fanout_exceeded' },
    ]);

    expect(row?.status).toBe('refused');
    expect(row?.reasonCode).toBe('trigger_fanout_exceeded');
  });

  it('locks a delivery only inside its environment', async () => {
    const environmentId = await tenant();
    const other = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const first = delivery(workflowId);
    await createWorkflowDeliveries(database.db, environmentId, [first]);

    await database.db.transaction(async (tx) => {
      await expect(lockWorkflowDelivery(tx, environmentId, first.id)).resolves.toMatchObject({
        id: first.id,
      });
      await expect(lockWorkflowDelivery(tx, other, first.id)).resolves.toBeNull();
    });
  });

  it('sweeps the pending and due, and stamps them so the next sweep leaves them', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const due = delivery(workflowId);
    const deferred = delivery(workflowId);
    const finished = delivery(workflowId);
    await createWorkflowDeliveries(database.db, environmentId, [due, deferred, finished]);
    const now = new Date(Date.now() + 60_000);
    await deferWorkflowDelivery(
      database.db,
      environmentId,
      deferred.id,
      new Date(now.getTime() + 60_000),
    );
    await finishWorkflowDelivery(database.db, environmentId, finished.id, {
      status: 'filtered',
      reasonCode: 'criteria',
    });

    const swept = await database.db.transaction((tx) =>
      listPendingWorkflowDeliveries(tx, { limit: 1_000, now }),
    );
    const again = await database.db.transaction((tx) =>
      listPendingWorkflowDeliveries(tx, { limit: 1_000, now }),
    );

    expect(swept.map((row) => row.id)).toContain(due.id);
    expect(swept.map((row) => row.id)).not.toContain(deferred.id);
    expect(swept.map((row) => row.id)).not.toContain(finished.id);
    expect(again.map((row) => row.id)).not.toContain(due.id);
  });

  it('sweeps again what was stamped long enough ago (a lost job)', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const lost = delivery(workflowId);
    await createWorkflowDeliveries(database.db, environmentId, [lost]);
    const now = new Date(Date.now() + 60_000);
    await database.db.transaction((tx) => listPendingWorkflowDeliveries(tx, { limit: 1_000, now }));

    const later = new Date(now.getTime() + 10 * 60_000);
    const swept = await database.db.transaction((tx) =>
      listPendingWorkflowDeliveries(tx, { limit: 1_000, now: later }),
    );

    expect(swept.map((row) => row.id)).toContain(lost.id);
  });

  it('a deferred delivery comes back when its time comes (C117.8)', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const deferred = delivery(workflowId);
    await createWorkflowDeliveries(database.db, environmentId, [deferred]);
    const notBefore = new Date(Date.now() + 60_000);
    await deferWorkflowDelivery(database.db, environmentId, deferred.id, notBefore);

    const swept = await database.db.transaction((tx) =>
      listPendingWorkflowDeliveries(tx, {
        limit: 1_000,
        now: new Date(notBefore.getTime() + 1_000),
      }),
    );

    expect(swept.map((row) => row.id)).toContain(deferred.id);
  });

  it('finishes a pending delivery once, with its run', async () => {
    const environmentId = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    const first = delivery(workflowId);
    await createWorkflowDeliveries(database.db, environmentId, [first]);
    const run = await seedWorkflowRun(database.db, environmentId, {
      workflowId,
      workflowVersionId: versionId,
    });

    const finished = await finishWorkflowDelivery(database.db, environmentId, first.id, {
      status: 'run_created',
      workflowRunId: run.id,
    });
    const repeated = await finishWorkflowDelivery(database.db, environmentId, first.id, {
      status: 'refused',
      reasonCode: 'workflow_not_running',
    });

    expect(finished).toMatchObject({ status: 'run_created', workflowRunId: run.id });
    expect(finished?.reasonCode).toBeNull();
    expect(repeated).toBeNull();
  });

  it('expires a pending delivery past the environment’s window, and stops there', async () => {
    const environmentId = await tenant();
    await updateEnvironmentSettings(database.db, environmentId, { 'event-retention-days': 1 });
    const { workflowId } = await publishedWorkflow(environmentId);
    const old = delivery(workflowId);
    const fresh = delivery(workflowId);
    await createWorkflowDeliveries(database.db, environmentId, [old, fresh]);
    await database.client.query(
      `update workflow_trigger_deliveries set created_at = now() - interval '3 days' where id = $1`,
      [old.id],
    );

    const expired = await expireWorkflowDeliveries(database.db, { limit: 1_000, now: new Date() });
    const repeated = await expireWorkflowDeliveries(database.db, { limit: 1_000, now: new Date() });

    expect(expired).toBeGreaterThanOrEqual(1);
    expect(repeated).toBe(0);
    await database.db.transaction(async (tx) => {
      await expect(lockWorkflowDelivery(tx, environmentId, old.id)).resolves.toMatchObject({
        status: 'expired',
        reasonCode: 'event_retention_passed',
      });
      await expect(lockWorkflowDelivery(tx, environmentId, fresh.id)).resolves.toMatchObject({
        status: 'pending',
      });
    });
  });

  it('lists newest first, ties by id, filtered by workflow and status (C1)', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await tenant();
    const first = await publishedWorkflow(environmentId);
    const second = await publishedWorkflow(environmentId);
    const clock = createdAtClock(database.db);
    const rows = [delivery(first.workflowId), delivery(first.workflowId)];
    const foreign = delivery(second.workflowId);
    await createWorkflowDeliveries(database.db, environmentId, [...rows, foreign]);
    await clock.at('workflow_trigger_deliveries', rows[0]?.id ?? '');
    await clock.at('workflow_trigger_deliveries', rows[1]?.id ?? '');
    await clock.at('workflow_trigger_deliveries', foreign.id);
    await finishWorkflowDelivery(database.db, environmentId, rows[0]?.id ?? '', {
      status: 'filtered',
      reasonCode: 'criteria',
    });

    const byWorkflow = await listWorkflowDeliveries(
      database.db,
      environmentId,
      { workflowIds: [first.workflowId] },
      {},
    );
    const byStatus = await listWorkflowDeliveries(
      database.db,
      environmentId,
      { statuses: ['filtered'] },
      {},
    );
    const firstPage = await listWorkflowDeliveries(database.db, environmentId, {}, { size: 2 });
    const secondPage = await listWorkflowDeliveries(
      database.db,
      environmentId,
      {},
      { size: 2, after: firstPage.next ?? undefined },
    );

    expect(byWorkflow.items.map((row) => row.id)).toEqual([rows[1]?.id, rows[0]?.id]);
    expect(byStatus.items.map((row) => row.id)).toEqual([rows[0]?.id]);
    expect(firstPage.items.map((row) => row.id)).toEqual([foreign.id, rows[1]?.id]);
    expect(secondPage.items.map((row) => row.id)).toEqual([rows[0]?.id]);
    await expect(
      listWorkflowDeliveries(database.db, environmentId, {}, { after: testId('wftd') }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe('schedules (C118.4)', () => {
  const schedule = (workflowId: string, nextFireAt: Date) => ({
    id: testId('wfsc'),
    workflowId,
    cron: '0 9 * * *',
    everyMinutes: null,
    timeZone: 'Europe/London',
    objectType: 'inquiry' as const,
    filter: null,
    onNull: null,
    batchCap: 100,
    nextFireAt,
  });

  it('holds one schedule per workflow, replaced whole, and removed by null', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const at = new Date(Date.now() - 1_000);
    await replaceWorkflowSchedule(database.db, environmentId, workflowId, schedule(workflowId, at));
    const replacement = schedule(workflowId, at);
    await replaceWorkflowSchedule(database.db, environmentId, workflowId, replacement);

    const due = await database.db.transaction((tx) =>
      listDueWorkflowSchedules(tx, { limit: 1_000, now: new Date() }),
    );
    expect(due.filter((row) => row.workflowId === workflowId).map((row) => row.id)).toEqual([
      replacement.id,
    ]);

    await replaceWorkflowSchedule(database.db, environmentId, workflowId, null);
    const after = await database.db.transaction((tx) =>
      listDueWorkflowSchedules(tx, { limit: 1_000, now: new Date() }),
    );
    expect(after.filter((row) => row.workflowId === workflowId)).toEqual([]);
  });

  it('reads the due schedules first, and leaves those not yet due', async () => {
    const environmentId = await tenant();
    const early = await publishedWorkflow(environmentId);
    const late = await publishedWorkflow(environmentId);
    const future = await publishedWorkflow(environmentId);
    const now = new Date();
    const earlyRow = schedule(early.workflowId, new Date(now.getTime() - 120_000));
    const lateRow = schedule(late.workflowId, new Date(now.getTime() - 60_000));
    const futureRow = schedule(future.workflowId, new Date(now.getTime() + 60_000));
    await replaceWorkflowSchedule(database.db, environmentId, late.workflowId, lateRow);
    await replaceWorkflowSchedule(database.db, environmentId, early.workflowId, earlyRow);
    await replaceWorkflowSchedule(database.db, environmentId, future.workflowId, futureRow);

    const due = await database.db.transaction((tx) =>
      listDueWorkflowSchedules(tx, { limit: 1_000, now }),
    );

    const ours = due.filter((row) => row.environmentId === environmentId).map((row) => row.id);
    expect(ours).toEqual([earlyRow.id, lateRow.id]);
  });

  it('advances the next fire, the last fire and the cursor', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const row = schedule(workflowId, new Date(Date.now() - 1_000));
    await replaceWorkflowSchedule(database.db, environmentId, workflowId, row);
    const nextFireAt = new Date(Date.now() + 3_600_000);
    const lastFiredAt = new Date();

    await advanceWorkflowSchedule(database.db, environmentId, row.id, {
      nextFireAt,
      lastFiredAt,
      cursor: 'inq_position',
    });

    const due = await database.db.transaction((tx) =>
      listDueWorkflowSchedules(tx, { limit: 1_000, now: new Date() }),
    );
    expect(due.map((candidate) => candidate.id)).not.toContain(row.id);
    const later = await database.db.transaction((tx) =>
      listDueWorkflowSchedules(tx, {
        limit: 1_000,
        now: new Date(nextFireAt.getTime() + 1_000),
      }),
    );
    expect(later.find((candidate) => candidate.id === row.id)).toMatchObject({
      cursor: 'inq_position',
      nextFireAt,
      lastFiredAt,
    });
  });
});

describe('the objects a tick reads (C118.4)', () => {
  it('reads oldest first, ties by id, from the cursor on, and stops at its limit', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await tenant();
    const clock = createdAtClock(database.db);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { inquiry } = await createTestInquiry(database.db, environmentId);
      await clock.at('inquiries', inquiry.id);
      ids.push(inquiry.id);
    }

    const first = await listWorkflowObjectsAfter(database.db, environmentId, 'inquiry', {
      cursor: null,
      limit: 2,
    });
    const next = await listWorkflowObjectsAfter(database.db, environmentId, 'inquiry', {
      cursor: first.at(-1) ?? null,
      limit: 2,
    });

    expect(first).toEqual(ids.slice(0, 2));
    expect(next).toEqual(ids.slice(2));
  });

  it('leaves a redacted object out, and another environment’s', async () => {
    const environmentId = await tenant();
    const other = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const { inquiry: redacted } = await createTestInquiry(database.db, environmentId);
    await createTestInquiry(database.db, other);
    await database.client.query(`update inquiries set redacted_at = now() where id = $1`, [
      redacted.id,
    ]);

    await expect(
      listWorkflowObjectsAfter(database.db, environmentId, 'inquiry', { cursor: null, limit: 10 }),
    ).resolves.toEqual([inquiry.id]);
  });

  it('starts over from a cursor it no longer finds, rather than skip every object', async () => {
    const environmentId = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);

    await expect(
      listWorkflowObjectsAfter(database.db, environmentId, 'inquiry', {
        cursor: testId('inq'),
        limit: 10,
      }),
    ).resolves.toEqual([inquiry.id]);
  });

  it.each(['account', 'report', 'transaction'] as const)(
    'reads no %s it does not hold',
    async (type) => {
      const environmentId = await tenant();

      await expect(
        listWorkflowObjectsAfter(database.db, environmentId, type, { cursor: null, limit: 10 }),
      ).resolves.toEqual([]);
    },
  );

  it('has no case until Workflow 8B', async () => {
    const environmentId = await tenant();

    await expect(
      listWorkflowObjectsAfter(database.db, environmentId, 'case', { cursor: null, limit: 10 }),
    ).resolves.toEqual([]);
  });
});

describe('scheduled runs (C118.3)', () => {
  const scheduled = (targetWorkflowId: string, overrides: { subjectId?: string } = {}) => ({
    id: testId('srrun'),
    targetWorkflowId,
    sourceRunId: null,
    subjectId: overrides.subjectId ?? null,
    baseAt: new Date(),
    offsetValue: 2,
    offsetUnit: 'hours' as const,
    offsetDirection: 'after' as const,
    fireAt: new Date(Date.now() - 1_000),
    inputs: { reference: 'synthetic-canary-input' },
  });

  it('seals its inputs and reads them back for its row', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);

    const row = await createScheduledRun(database.db, environmentId, scheduled(workflowId));

    const stored = await database.client.query<{ inputs: unknown }>(
      `select inputs from scheduled_runs where id = $1`,
      [row.id],
    );
    expect(JSON.stringify(stored.rows[0]?.inputs)).not.toContain('synthetic-canary-input');
    expect(scheduledRunInputs(row)).toEqual({ reference: 'synthetic-canary-input' });
  });

  it('reads no inputs when it holds none', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);

    const row = await createScheduledRun(database.db, environmentId, {
      ...scheduled(workflowId),
      inputs: null,
    });

    expect(scheduledRunInputs(row)).toBeNull();
  });

  it('reads what is due, and finishes it once', async () => {
    const environmentId = await tenant();
    const { workflowId, versionId } = await publishedWorkflow(environmentId);
    const row = await createScheduledRun(database.db, environmentId, scheduled(workflowId));
    const future = await createScheduledRun(database.db, environmentId, {
      ...scheduled(workflowId),
      fireAt: new Date(Date.now() + 60_000),
    });
    const run = await seedWorkflowRun(database.db, environmentId, {
      workflowId,
      workflowVersionId: versionId,
    });

    const due = await database.db.transaction((tx) =>
      listDueScheduledRuns(tx, { limit: 1_000, now: new Date() }),
    );
    expect(due.map((candidate) => candidate.id)).toContain(row.id);
    expect(due.map((candidate) => candidate.id)).not.toContain(future.id);

    await finishScheduledRun(database.db, environmentId, row.id, {
      status: 'run_created',
      workflowRunId: run.id,
    });

    const after = await database.db.transaction((tx) =>
      listDueScheduledRuns(tx, { limit: 1_000, now: new Date() }),
    );
    expect(after.map((candidate) => candidate.id)).not.toContain(row.id);
  });

  it('cancels with its subject’s redaction, and only what is pending (C118.3)', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const subjectId = testId('inq');
    const row = await createScheduledRun(
      database.db,
      environmentId,
      scheduled(workflowId, { subjectId }),
    );
    const other = await createScheduledRun(database.db, environmentId, scheduled(workflowId));

    const canceled = await cancelScheduledRunsForSubjects(database.db, environmentId, [subjectId]);
    const repeated = await cancelScheduledRunsForSubjects(database.db, environmentId, [subjectId]);
    const none = await cancelScheduledRunsForSubjects(database.db, environmentId, []);

    expect([canceled, repeated, none]).toEqual([1, 0, 0]);
    const due = await database.db.transaction((tx) =>
      listDueScheduledRuns(tx, { limit: 1_000, now: new Date() }),
    );
    expect(due.map((candidate) => candidate.id)).not.toContain(row.id);
    expect(due.map((candidate) => candidate.id)).toContain(other.id);
    const stored = await database.client.query<{ reason_code: string; inputs: unknown }>(
      `select reason_code, inputs from scheduled_runs where id = $1`,
      [row.id],
    );
    expect(stored.rows[0]).toEqual({ reason_code: 'subject_redacted', inputs: null });
  });

  it('cancels when its target workflow is archived (C118.3)', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    await createScheduledRun(database.db, environmentId, scheduled(workflowId));

    await expect(
      cancelScheduledRunsForWorkflow(database.db, environmentId, workflowId),
    ).resolves.toBe(1);

    const stored = await database.client.query<{ reason_code: string }>(
      `select reason_code from scheduled_runs where target_workflow_id = $1`,
      [workflowId],
    );
    expect(stored.rows[0]?.reason_code).toBe('workflow_archived');
  });
});

describe('account actions (C118.7)', () => {
  const action = (workflowId: string, accountTypeId: string) => ({
    id: testId('accac'),
    workflowId,
    accountTypeId,
    label: 'Re-check',
    prefill: { reference: 'account.fields.reference' },
  });

  it('creates, reads and updates one', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const accountType = await newAccountType(environmentId);

    const row = await createAccountAction(
      database.db,
      environmentId,
      action(workflowId, accountType.id),
    );
    const read = await getAccountAction(database.db, environmentId, row.id);
    const updated = await updateAccountAction(database.db, environmentId, row.id, {
      label: 'Review',
      status: 'archived',
    });

    expect(row).toMatchObject({ status: 'active', label: 'Re-check' });
    expect(read?.prefill).toEqual({ reference: 'account.fields.reference' });
    expect(updated).toMatchObject({
      label: 'Review',
      status: 'archived',
      prefill: { reference: 'account.fields.reference' },
    });
  });

  it('answers null for an unknown id or another environment', async () => {
    const environmentId = await tenant();
    const other = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const accountType = await newAccountType(environmentId);
    const row = await createAccountAction(
      database.db,
      environmentId,
      action(workflowId, accountType.id),
    );

    await expect(getAccountAction(database.db, other, row.id)).resolves.toBeNull();
    await expect(
      updateAccountAction(database.db, other, row.id, { label: 'Refused' }),
    ).resolves.toBeNull();
  });

  it('lists newest first, ties by id, and filters (C1)', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const accountType = await newAccountType(environmentId);
    const clock = createdAtClock(database.db);
    const first = await createAccountAction(
      database.db,
      environmentId,
      action(workflowId, accountType.id),
    );
    const second = await createAccountAction(
      database.db,
      environmentId,
      action(workflowId, accountType.id),
    );
    await clock.at('account_actions', first.id);
    await clock.at('account_actions', second.id);
    await updateAccountAction(database.db, environmentId, first.id, { status: 'archived' });

    const page = await listAccountActions(database.db, environmentId, {}, { size: 1 });
    const next = await listAccountActions(
      database.db,
      environmentId,
      {},
      { size: 1, after: page.next ?? undefined },
    );
    const archived = await listAccountActions(
      database.db,
      environmentId,
      { statuses: ['archived'] },
      {},
    );
    const byType = await listAccountActions(
      database.db,
      environmentId,
      { accountTypeIds: [accountType.id], workflowIds: [workflowId] },
      {},
    );

    expect(page.items.map((row) => row.id)).toEqual([second.id]);
    expect(next.items.map((row) => row.id)).toEqual([first.id]);
    expect(archived.items.map((row) => row.id)).toEqual([first.id]);
    expect(byType.items.map((row) => row.id)).toEqual([second.id, first.id]);
  });

  it('starts the available actions from the active ones of the type', async () => {
    const environmentId = await tenant();
    const { workflowId } = await publishedWorkflow(environmentId);
    const accountType = await newAccountType(environmentId);
    const otherType = await newAccountType(environmentId);
    const active = await createAccountAction(
      database.db,
      environmentId,
      action(workflowId, accountType.id),
    );
    const archived = await createAccountAction(
      database.db,
      environmentId,
      action(workflowId, accountType.id),
    );
    await updateAccountAction(database.db, environmentId, archived.id, { status: 'archived' });
    await createAccountAction(database.db, environmentId, action(workflowId, otherType.id));

    const found = await listAccountActionsForType(database.db, environmentId, accountType.id);

    expect(found.map((row) => row.id)).toEqual([active.id]);
  });
});
