/**
 * C118.1, C117.7, C118.8, C120.7: what `stage()` writes for a workflow. A delivery exists if and only
 * if its event committed, exactly once per event and workflow, and nothing here reads a condition.
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { listWorkflowDeliveries, replaceWorkflowTriggers } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedWorkflow,
  seedWorkflowVersion,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORKFLOW_RUN_LIMITS } from '@openverify/workflow-engine';
import { stageWorkflowTriggersInTx, type TriggerEventCause } from './stage-hook.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const tenant = async () => (await createTestTenant(database.db)).environment.id;

/** A running workflow, indexed for `eventName`. */
async function listening(environmentId: string, eventName = 'inquiry.completed') {
  const workflow = await seedWorkflow(database.db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(database.db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
  });
  await replaceWorkflowTriggers(database.db, environmentId, workflow.id, [
    { kind: 'trigger-event', eventName, workflowVersionId: version.id },
  ]);
  return workflow.id;
}

const facts = (environmentId: string, name = 'inquiry.completed') => ({
  environmentId,
  eventId: newId('evt'),
  name,
  payload: { data: { type: 'inquiry', id: newId('inq'), attributes: {} } },
  cause: undefined,
});

const deliveriesOf = async (environmentId: string, workflowId?: string) =>
  (
    await listWorkflowDeliveries(
      database.db,
      environmentId,
      workflowId === undefined ? {} : { workflowIds: [workflowId] },
      { size: 100 },
    )
  ).items;

describe('stageWorkflowTriggersInTx (C118.1)', () => {
  it('writes one delivery per workflow listening, and answers their jobs', async () => {
    const environmentId = await tenant();
    const first = await listening(environmentId);
    const second = await listening(environmentId);
    await listening(environmentId, 'inquiry.approved');
    const event = facts(environmentId);

    const jobs = await database.db.transaction((tx) => stageWorkflowTriggersInTx(tx, event));

    const rows = await deliveriesOf(environmentId);
    expect(rows.map((row) => row.workflowId).sort()).toEqual([first, second].sort());
    expect(rows.every((row) => row.status === 'pending' && row.eventId === event.eventId)).toBe(
      true,
    );
    expect(jobs.map((job) => job.deliveryId).sort()).toEqual(rows.map((row) => row.id).sort());
    expect(jobs.every((job) => job.environmentId === environmentId)).toBe(true);
  });

  it('writes nothing when nothing listens', async () => {
    const environmentId = await tenant();

    const jobs = await database.db.transaction((tx) =>
      stageWorkflowTriggersInTx(tx, facts(environmentId)),
    );

    expect(jobs).toEqual([]);
    await expect(deliveriesOf(environmentId)).resolves.toEqual([]);
  });

  it('never reads another environment’s index (C121.6)', async () => {
    const environmentId = await tenant();
    const other = await tenant();
    await listening(other);

    const jobs = await database.db.transaction((tx) =>
      stageWorkflowTriggersInTx(tx, facts(environmentId)),
    );

    expect(jobs).toEqual([]);
  });

  it('leaves no delivery when the event’s transaction rolls back', async () => {
    const environmentId = await tenant();
    await listening(environmentId);

    await expect(
      database.db.transaction(async (tx) => {
        await stageWorkflowTriggersInTx(tx, facts(environmentId));
        throw new Error('the event’s transaction failed');
      }),
    ).rejects.toThrow('failed');

    await expect(deliveriesOf(environmentId)).resolves.toEqual([]);
  });

  it('owes one delivery for one event and workflow, however often it is staged', async () => {
    const environmentId = await tenant();
    const workflowId = await listening(environmentId);
    const event = facts(environmentId);

    await database.db.transaction((tx) => stageWorkflowTriggersInTx(tx, event));
    const repeated = await database.db.transaction((tx) => stageWorkflowTriggersInTx(tx, event));

    expect(repeated).toEqual([]);
    await expect(deliveriesOf(environmentId, workflowId)).resolves.toHaveLength(1);
  });

  it.each(['workflow-run.completed', 'workflow.published', 'workflow-version.published'])(
    'never starts a workflow from %s, whatever the index holds (C118.8)',
    async (name) => {
      const environmentId = await tenant();
      await listening(environmentId, name);

      const jobs = await database.db.transaction((tx) =>
        stageWorkflowTriggersInTx(tx, facts(environmentId, name)),
      );

      expect(jobs).toEqual([]);
      await expect(deliveriesOf(environmentId)).resolves.toEqual([]);
    },
  );

  it('leaves the events a test run causes alone (C120.7)', async () => {
    const environmentId = await tenant();
    await listening(environmentId);

    const jobs = await database.db.transaction((tx) =>
      stageWorkflowTriggersInTx(tx, {
        ...facts(environmentId),
        cause: { testRunId: newId('wfr') },
      }),
    );

    expect(jobs).toEqual([]);
    await expect(deliveriesOf(environmentId)).resolves.toEqual([]);
  });

  it('takes a test run’s events when the request opted in (C120.7)', async () => {
    const environmentId = await tenant();
    await listening(environmentId);
    const cause: TriggerEventCause = { testRunId: newId('wfr'), testRunAllowsTriggers: true };

    const jobs = await database.db.transaction((tx) =>
      stageWorkflowTriggersInTx(tx, { ...facts(environmentId), cause }),
    );

    expect(jobs).toHaveLength(1);
  });

  it('refuses the delivery past the fan-out cap, and lists it (C117.7, H18)', async () => {
    const environmentId = await tenant();
    const cap = WORKFLOW_RUN_LIMITS['event-fanout'].value;
    for (let index = 0; index < cap + 1; index += 1) {
      await listening(environmentId);
    }
    const event = facts(environmentId);

    const jobs = await database.db.transaction((tx) => stageWorkflowTriggersInTx(tx, event));

    const rows = await deliveriesOf(environmentId);
    expect(rows).toHaveLength(cap + 1);
    expect(jobs).toHaveLength(cap);
    const refused = rows.filter((row) => row.status === 'refused');
    expect(refused.map((row) => row.reasonCode)).toEqual(['trigger_fanout_exceeded']);
    expect(jobs.map((job) => job.deliveryId)).not.toContain(refused[0]?.id);
  });
});
