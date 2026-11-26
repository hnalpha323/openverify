/**
 * C118 over the real engine, with the real publisher: an event reaches a run's end, a repeated job
 * starts one run, and a schedule and a scheduled run each start a run the engine carries through.
 * Handlers are fakes; `action-port` says why. Every value is synthetic.
 */
import { buildInquiryResource, newId, type WorkflowDefinition } from '@openverify/contracts';
import {
  getWorkflowRun,
  listDueScheduledRuns,
  listDueWorkflowSchedules,
  listWorkflowDeliveries,
  openWorkflowRunValues,
  replaceWorkflowSchedule,
  replaceWorkflowTriggers,
  scheduledRunInputs,
} from '@openverify/db';
import { createTestInquiry, seedWorkflow, seedWorkflowVersion } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../../events/index.js';
import {
  runScheduledRunsSweep,
  runWorkflowScheduleSweep,
  runWorkflowTriggerSweep,
} from '../../jobs/repeatable/workflows.js';
import { createAllowAllRateLimiter } from '../../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import type { WorkflowServices } from '../services.js';
import { chain, createEngineHarness, drain, runOf, type EngineHarness } from '../engine/testing.js';
import { processWorkflowTrigger } from './deliver.js';
import { SCHEDULE_WORKFLOW_HANDLER } from './schedule-workflow.js';

const EVENT = 'inquiry.completed';
const at = new Date('2026-10-20T12:00:00.000Z');

let harness: EngineHarness;
let triggerJobs: { environmentId: string; deliveryId: string }[];

beforeAll(async () => {
  harness = await createEngineHarness([SCHEDULE_WORKFLOW_HANDLER]);
  triggerJobs = [];
  const queue = {
    enqueueWorkflowTrigger: (job: { environmentId: string; deliveryId: string }) => {
      triggerJobs.push(job);
      return Promise.resolve();
    },
  };
  const services = harness.deps.services as unknown as {
    rateLimiter: unknown;
    events: unknown;
    ids: unknown;
  };
  services.rateLimiter = createAllowAllRateLimiter();
  harness.deps.triggers = queue;
  const publisher = createEventPublisher({
    db: harness.db,
    deliveries: createWebhookDeliveryScheduler({
      add: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
    workflowTriggers: queue,
  });
  (harness.deps.services as WorkflowServices & { events: typeof publisher }).events = publisher;
  harness.events = publisher;
}, 120_000);

afterAll(async () => {
  await harness.close();
});

async function live(definition: WorkflowDefinition) {
  const { db, environmentId } = harness;
  const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definition,
  });
  await harness.database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  return { workflowId: workflow.id, versionId: version.id };
}

const eventDefinition = chain([], {
  trigger: { type: 'trigger-event', config: { events: [EVENT] } },
});

async function listening() {
  const published = await live(eventDefinition);
  await replaceWorkflowTriggers(harness.db, harness.environmentId, published.workflowId, [
    { kind: 'trigger-event', eventName: EVENT, workflowVersionId: published.versionId },
  ]);
  return published;
}

const payload = () => ({
  data: buildInquiryResource({
    id: newId('inq'),
    status: 'completed',
    referenceId: 'ref-synthetic-1',
    fields: {},
    inquiryTemplateId: newId('itmpl'),
    verifications: [],
    createdAt: at,
    updatedAt: at,
  }),
});

const deliveriesOf = async (workflowId: string) =>
  (
    await listWorkflowDeliveries(
      harness.db,
      harness.environmentId,
      { workflowIds: [workflowId] },
      {},
    )
  ).items;

describe('an event, end to end (C118.1)', () => {
  it('stages a delivery, wakes the worker, and ends in a finished run', async () => {
    const { workflowId } = await listening();
    const event = payload();

    await harness.events.publish({
      environmentId: harness.environmentId,
      name: EVENT,
      payload: event,
    });

    const [pending] = await deliveriesOf(workflowId);
    const job = triggerJobs.splice(0).find(({ deliveryId }) => deliveryId === pending?.id);
    if (job === undefined) {
      throw new Error('no job');
    }
    await processWorkflowTrigger(job, harness.deps);
    await drain(harness);

    const [delivery] = await deliveriesOf(workflowId);
    expect(delivery).toMatchObject({ status: 'run_created' });
    const run = await runOf(harness, delivery?.workflowRunId ?? '');
    expect(run).toMatchObject({ status: 'completed', creatorType: 'event', triggerDepth: 0 });
    expect(openWorkflowRunValues(run).triggerSnapshot).toMatchObject({
      id: event.data.id,
      status: 'completed',
    });
  });

  it('starts one run however often the job is repeated', async () => {
    const { workflowId } = await listening();
    await harness.events.publish({
      environmentId: harness.environmentId,
      name: EVENT,
      payload: payload(),
    });
    const [delivery] = await deliveriesOf(workflowId);
    const job = triggerJobs.splice(0).find(({ deliveryId }) => deliveryId === delivery?.id);
    if (job === undefined) {
      throw new Error('no job');
    }

    await processWorkflowTrigger(job, harness.deps);
    await processWorkflowTrigger(job, harness.deps);

    const { rows } = await harness.database.client.query<{ count: string }>(
      `select count(*)::text as count from workflow_runs where workflow_id = $1`,
      [workflowId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('recovers a lost job through the sweep', async () => {
    const { workflowId } = await listening();
    await harness.events.publish({
      environmentId: harness.environmentId,
      name: EVENT,
      payload: payload(),
    });
    triggerJobs.splice(0);

    await runWorkflowTriggerSweep(harness.deps);

    const [delivery] = await deliveriesOf(workflowId);
    const job = triggerJobs.splice(0).find(({ deliveryId }) => deliveryId === delivery?.id);
    if (job === undefined) {
      throw new Error('the sweep woke nothing');
    }
    await processWorkflowTrigger(job, harness.deps);

    expect((await deliveriesOf(workflowId))[0]).toMatchObject({ status: 'run_created' });
  });
});

describe('a recurring schedule, end to end (C118.4)', () => {
  it('starts a run per object through the sweep', async () => {
    const { db, environmentId } = harness;
    const { inquiry } = await createTestInquiry(db, environmentId);
    const { workflowId } = await live(
      chain([], {
        trigger: {
          type: 'trigger-recurring',
          config: { 'every-minutes': 60, 'time-zone': 'UTC', 'object-type': 'inquiry' },
        },
      }),
    );
    await replaceWorkflowSchedule(db, environmentId, workflowId, {
      id: newId('wfsc'),
      workflowId,
      cron: null,
      everyMinutes: 60,
      timeZone: 'UTC',
      objectType: 'inquiry',
      filter: null,
      onNull: null,
      batchCap: 100,
      nextFireAt: new Date(Date.now() - 1_000),
    });

    await runWorkflowScheduleSweep(harness.deps);
    await runWorkflowScheduleSweep(harness.deps);
    await drain(harness);

    const { rows } = await harness.database.client.query<{ id: string; status: string }>(
      `select r.id, r.status from workflow_runs r
        join workflow_run_subjects s on s.run_id = r.id
       where r.workflow_id = $1 and s.subject_id = $2`,
      [workflowId, inquiry.id],
    );
    expect(rows).toEqual([{ id: rows[0]?.id, status: 'completed' }]);
    const due = await db.transaction((tx) =>
      listDueWorkflowSchedules(tx, { limit: 1_000, now: new Date() }),
    );
    expect(due.map((row) => row.workflowId)).not.toContain(workflowId);
  });
});

describe('Schedule Workflow, end to end (C118.3)', () => {
  it('writes a row from a step, and the sweep starts the run at its time', async () => {
    const { db, environmentId } = harness;
    const scheduledTarget = await live(
      chain([], {
        trigger: { type: 'trigger-schedule', config: {} },
        inputs: [{ name: 'reference', type: 'string', required: true }],
      }),
    );
    const source = await live(
      chain(
        [
          {
            id: 'later',
            type: 'action',
            name: 'later',
            'action-key': 'schedule_workflow',
            'action-version': 1,
            config: {
              'workflow-id': scheduledTarget.workflowId,
              'base-time': 'run-time',
              offset: 1,
              units: 'minutes',
              direction: 'before',
              inputs: { reference: 'ref-synthetic' },
            },
          },
        ],
        { trigger: { type: 'trigger-api', config: {} } },
      ),
    );
    const { startWorkflowRunInTx, wakeStartedRun } = await import('../engine/start-run.js');
    const { engineDepsOf } = await import('../engine/worker-deps.js');
    const engine = engineDepsOf(harness.deps);
    const started = await db.transaction((tx) =>
      startWorkflowRunInTx(tx, engine, {
        environmentId,
        workflowId: source.workflowId,
        workflowVersionId: source.versionId,
        triggerType: 'trigger-api',
        creator: { type: 'api-key', id: newId('key') },
        trigger: {},
        inputs: {},
        subjectIds: [],
        grant: { scopes: ['workflows:trigger'], pii: false },
      }),
    );
    await wakeStartedRun(engine, started);
    await drain(harness);

    const finished = await getWorkflowRun(db, environmentId, started.run.id);
    expect(finished?.status).toBe('completed');
    const rows = await db.transaction((tx) =>
      listDueScheduledRuns(tx, { limit: 1_000, now: new Date() }),
    );
    const row = rows.find(({ sourceRunId }) => sourceRunId === started.run.id);
    expect(row === undefined ? null : scheduledRunInputs(row)).toEqual({
      reference: 'ref-synthetic',
    });

    await runScheduledRunsSweep(harness.deps);
    await drain(harness);

    const { rows: runs } = await harness.database.client.query<{
      id: string;
      status: string;
      creator_type: string;
      depth: number;
      root_run_id: string;
    }>(
      `select id, status, creator_type, depth, root_run_id from workflow_runs
        where workflow_id = $1`,
      [scheduledTarget.workflowId],
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'completed',
      creator_type: 'scheduled-run',
      depth: 1,
      root_run_id: started.run.id,
    });
  });
});
