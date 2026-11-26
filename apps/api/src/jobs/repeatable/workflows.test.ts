/**
 * C143.1, C118: the trigger side's sweeps. Each is the outbox of what a wake-up lost, so each finds
 * what is due, leaves what is not, and survives a failed enqueue. Synthetic values.
 */
import { newId } from '@openverify/contracts';
import {
  advanceWorkflowSchedule,
  createScheduledRun,
  createWorkflowDeliveries,
  listWorkflowDeliveries,
  replaceWorkflowSchedule,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedWorkflow,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAllowAllRateLimiter } from '../../test-support/fakes.js';
import type { WorkflowServices } from '../../workflows/services.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';
import { createCapturingLogger } from '../testing.js';
import {
  runScheduledRunsSweep,
  runWorkflowScheduleSweep,
  runWorkflowTriggerSweep,
} from './workflows.js';

const parts = vi.hoisted(() => ({
  tick: vi.fn(),
  fire: vi.fn(),
  wake: vi.fn(),
}));
vi.mock('../../workflows/triggers/schedules.js', () => ({ tickWorkflowSchedule: parts.tick }));
vi.mock('../../workflows/triggers/scheduled-runs.js', () => ({ fireScheduledRun: parts.fire }));
vi.mock('../../workflows/engine/start-run.js', () => ({ wakeStartedRun: parts.wake }));

let database: TestDatabase;
let db: Db;
let environmentId: string;
let enqueue: ReturnType<typeof vi.fn>;
let logger: ReturnType<typeof createCapturingLogger>;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  environmentId = (await createTestTenant(db)).environment.id;
  enqueue = vi.fn(() => Promise.resolve());
  logger = createCapturingLogger();
  parts.tick.mockReset().mockResolvedValue([]);
  parts.fire.mockReset().mockResolvedValue(null);
  parts.wake.mockReset().mockResolvedValue(undefined);
});

const NOW = new Date(Date.now() + 86_400_000);

const deps = () =>
  ({
    db,
    clock: { now: () => NOW },
    logger,
    services: {
      rateLimiter: createAllowAllRateLimiter(),
      ids: { newId },
    } as unknown as WorkflowServices,
    steps: { enqueueWorkflowStep: () => Promise.resolve() },
    triggers: { enqueueWorkflowTrigger: enqueue },
    waitMatches: { enqueueWorkflowWaitMatch: () => Promise.resolve() },
    actions: { registry: {}, handlers: {} },
  }) as unknown as WorkflowWorkerDeps;

const pendingDelivery = async () => {
  const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
  const id = newId('wftd');
  await createWorkflowDeliveries(db, environmentId, [
    { id, eventId: newId('evt'), eventName: 'inquiry.completed', workflowId: workflow.id },
  ]);
  return id;
};

describe('workflow-trigger-sweep (C118.1)', () => {
  it('wakes a pending delivery, once', async () => {
    const id = await pendingDelivery();

    await runWorkflowTriggerSweep(deps());
    await runWorkflowTriggerSweep(deps());

    expect(
      enqueue.mock.calls.filter(([job]) => (job as { deliveryId: string }).deliveryId === id),
    ).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledWith({ environmentId, deliveryId: id });
  });

  it('survives a failed enqueue, and logs no value', async () => {
    const id = await pendingDelivery();
    enqueue.mockRejectedValue(new Error('valkey is down'));

    await expect(runWorkflowTriggerSweep(deps())).resolves.toBeUndefined();

    expect(logger.entries.map(({ object }) => object.deliveryId)).toContain(id);
  });

  it('leaves a finished delivery', async () => {
    const id = await pendingDelivery();
    await database.client.query(
      `update workflow_trigger_deliveries set status = 'filtered', reason_code = 'criteria_not_met'
       where id = $1`,
      [id],
    );

    await runWorkflowTriggerSweep(deps());

    expect(
      enqueue.mock.calls.map(([job]) => (job as { deliveryId: string }).deliveryId),
    ).not.toContain(id);
    const { items } = await listWorkflowDeliveries(db, environmentId, {}, {});
    expect(items[0]?.status).toBe('filtered');
  });
});

describe('workflow-schedule-sweep (C118.4)', () => {
  const dueSchedule = async () => {
    const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
    await replaceWorkflowSchedule(db, environmentId, workflow.id, {
      id: newId('wfsc'),
      workflowId: workflow.id,
      cron: null,
      everyMinutes: 60,
      timeZone: 'UTC',
      objectType: 'inquiry',
      filter: null,
      onNull: null,
      batchCap: 100,
      nextFireAt: new Date(NOW.getTime() - 1_000),
    });
    return workflow.id;
  };

  it('ticks each due schedule and wakes what it started, after the commit', async () => {
    const workflowId = await dueSchedule();
    const run = { run: { id: newId('wfr') }, created: true, after: {} };
    parts.tick.mockImplementation(async (tx: Db, _deps, schedule: { id: string }) => {
      await advanceWorkflowSchedule(tx, environmentId, schedule.id, {
        nextFireAt: new Date(NOW.getTime() + 3_600_000),
        lastFiredAt: NOW,
        cursor: null,
      });
      return [run];
    });

    await runWorkflowScheduleSweep(deps());

    expect(
      parts.tick.mock.calls.map(
        ([, , schedule]) => (schedule as { workflowId: string }).workflowId,
      ),
    ).toContain(workflowId);
    expect(parts.wake).toHaveBeenCalled();
  });

  it('stops at its share of one sweep, whatever a tick left due', async () => {
    await dueSchedule();
    parts.tick.mockResolvedValue([]);

    await expect(runWorkflowScheduleSweep(deps())).resolves.toBeUndefined();

    expect(parts.tick.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it('keeps going past a schedule that fails, and logs its id', async () => {
    const workflowId = await dueSchedule();
    parts.tick.mockRejectedValue(new Error('synthetic failure'));

    await expect(runWorkflowScheduleSweep(deps())).resolves.toBeUndefined();

    expect(logger.entries.map(({ object }) => object.workflowId)).toContain(workflowId);
  });
});

describe('workflow-scheduled-runs (C118.3)', () => {
  const dueRun = async () => {
    const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
    return createScheduledRun(db, environmentId, {
      id: newId('srrun'),
      targetWorkflowId: workflow.id,
      sourceRunId: null,
      subjectId: null,
      baseAt: NOW,
      offsetValue: 1,
      offsetUnit: 'hours',
      offsetDirection: 'after',
      fireAt: new Date(NOW.getTime() - 1_000),
      inputs: null,
    });
  };

  it('fires each due run and wakes what it started', async () => {
    const row = await dueRun();
    const started = { run: { id: newId('wfr') }, created: true, after: {} };
    parts.fire.mockResolvedValue(started);

    await runScheduledRunsSweep(deps());

    expect(
      parts.fire.mock.calls.map(([, , scheduled]) => (scheduled as { id: string }).id),
    ).toContain(row.id);
    expect(parts.wake).toHaveBeenCalledWith(expect.anything(), started);
  });

  it('keeps going past one that fails, and logs its id', async () => {
    const row = await dueRun();
    parts.fire.mockRejectedValue(new Error('synthetic failure'));

    await expect(runScheduledRunsSweep(deps())).resolves.toBeUndefined();

    expect(logger.entries.map(({ object }) => object.scheduledRunId)).toContain(row.id);
  });
});
