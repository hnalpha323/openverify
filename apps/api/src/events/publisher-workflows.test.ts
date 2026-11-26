/**
 * C118.1, C119.3, C121.3 (F02, F03): what `stage()` and `dispatch()` do for workflows. `stage()` only
 * calls its owners' hooks, in the event's transaction, and writes the event's cause beside it;
 * `dispatch()` enqueues what they answered, best effort after the commit, so a lost enqueue is the
 * sweeps' to find and never fails anything.
 */
import { buildInquiryResource, newId, type EventPayload } from '@openverify/contracts';
import { getEvent } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapturingLogger, createRecordingQueue } from '../jobs/testing.js';
import type { IdGenerator } from '../ports.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { runWithEventCause } from './cause-context.js';
import { createEventPublisher } from './index.js';

const triggerHook = vi.hoisted(() => vi.fn());
vi.mock('../workflows/triggers/stage-hook.js', () => ({ stageWorkflowTriggersInTx: triggerHook }));
const waitHook = vi.hoisted(() => vi.fn());
vi.mock('../workflows/engine/wait-resolution.js', () => ({ recordWaitCandidatesInTx: waitHook }));

const at = new Date('2026-10-20T12:00:00.000Z');

function payload(): EventPayload {
  return {
    data: buildInquiryResource({
      id: newId('inq'),
      status: 'completed',
      referenceId: 'ref-synthetic-1',
      fields: { name_first: 'Synthetic' },
      inquiryTemplateId: newId('itmpl'),
      verifications: [],
      createdAt: at,
      updatedAt: at,
    }),
  };
}

let database: TestDatabase;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  triggerHook.mockReset().mockResolvedValue([]);
  waitHook.mockReset().mockResolvedValue([]);
});

function publisher(extra: Parameters<typeof createEventPublisher>[0] | object = {}) {
  return createEventPublisher({
    db: database.db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    ...extra,
  });
}

describe('stage(): the cause (C121.3)', () => {
  const stageIn = (events: ReturnType<typeof publisher>, cause?: object) =>
    database.db.transaction((tx) =>
      events.stage(tx, {
        environmentId,
        name: 'inquiry.completed',
        payload: payload(),
        ...(cause === undefined ? {} : { cause }),
      }),
    );

  it('writes the cause it is given', async () => {
    const runId = newId('wfr');

    const { eventId } = await stageIn(publisher(), { runId });

    expect((await getEvent(database.db, environmentId, eventId))?.causedByRunId).toBe(runId);
  });

  it('reads the context when it is given none, so no call site changes', async () => {
    const principal = newId('usr');

    const { eventId } = await runWithEventCause(
      { principal, principalHeldInquiriesWrite: false },
      () => stageIn(publisher()),
    );

    expect(await getEvent(database.db, environmentId, eventId)).toMatchObject({
      causedByPrincipal: principal,
      causedByPrincipalHeldInquiriesWrite: false,
    });
  });

  it('takes the cause it is given over the context', async () => {
    const runId = newId('wfr');

    const { eventId } = await runWithEventCause({ principal: newId('usr') }, () =>
      stageIn(publisher(), { runId }),
    );

    expect(await getEvent(database.db, environmentId, eventId)).toMatchObject({
      causedByRunId: runId,
      causedByPrincipal: null,
    });
  });

  it('leaves it empty for a system job or the flow', async () => {
    const { eventId } = await stageIn(publisher());

    expect(await getEvent(database.db, environmentId, eventId)).toMatchObject({
      causedByRunId: null,
      causedByPrincipal: null,
      causedByTestRunId: null,
      causedByBulkId: null,
      causedByPrincipalHeldInquiriesWrite: null,
    });
  });

  it('records a test run and a bulk job the same way', async () => {
    const testRunId = newId('wfr');
    const bulkId = newId('cblk');

    const { eventId } = await runWithEventCause({ testRunId, bulkId }, () => stageIn(publisher()));

    expect(await getEvent(database.db, environmentId, eventId)).toMatchObject({
      causedByTestRunId: testRunId,
      causedByBulkId: bulkId,
    });
  });

  it('never puts a cause in the payload', async () => {
    const principal = newId('usr');

    const { eventId } = await stageIn(publisher(), { principal });

    const event = await getEvent(database.db, environmentId, eventId);
    expect(JSON.stringify(event?.payload)).not.toContain(principal);
  });
});

describe('stage(): the hooks (C118.1, C119.3)', () => {
  it('calls each owner’s hook with the event, in the event’s transaction', async () => {
    const events = publisher();
    const body = payload();
    const cause = { runId: newId('wfr') };

    const { eventId } = await database.db.transaction(async (tx) => {
      const staged = await events.stage(tx, {
        environmentId,
        name: 'inquiry.completed',
        payload: body,
        cause,
      });
      expect(triggerHook.mock.calls[0]?.[0]).toBe(tx);
      expect(waitHook.mock.calls[0]?.[0]).toBe(tx);
      return staged;
    });

    const facts = { environmentId, eventId, name: 'inquiry.completed', payload: body, cause };
    expect(triggerHook.mock.calls[0]?.[1]).toEqual(facts);
    expect(waitHook.mock.calls[0]?.[1]).toEqual(facts);
  });

  it('returns what they answer, for dispatch()', async () => {
    const delivery = { environmentId, deliveryId: newId('wftd') };
    const candidate = { environmentId, eventId: newId('evt') };
    triggerHook.mockResolvedValue([delivery]);
    waitHook.mockResolvedValue([candidate]);

    const staged = await database.db.transaction((tx) =>
      publisher().stage(tx, { environmentId, name: 'inquiry.completed', payload: payload() }),
    );

    expect(staged.workflowDeliveries).toEqual([delivery]);
    expect(staged.waitCandidates).toEqual([candidate]);
  });

  it('rolls the event back when a hook fails: a delivery exists if and only if it committed', async () => {
    triggerHook.mockRejectedValue(new Error('synthetic'));
    const id = newId('evt');
    const ids = { newId: () => id } as unknown as IdGenerator;

    await expect(
      database.db.transaction((tx) =>
        createEventPublisher({
          db: database.db,
          deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
          ids,
        }).stage(tx, { environmentId, name: 'inquiry.completed', payload: payload() }),
      ),
    ).rejects.toThrow('synthetic');

    expect(await getEvent(database.db, environmentId, id)).toBeNull();
  });
});

describe('dispatch() (F02)', () => {
  const staged = () => ({
    eventId: newId('evt'),
    deliveries: [],
    workflowDeliveries: [{ environmentId, deliveryId: newId('wftd') }],
    waitCandidates: [{ environmentId, eventId: newId('evt') }],
  });

  it('enqueues every delivery and wait candidate after the commit', async () => {
    const workflowTriggers = { enqueueWorkflowTrigger: vi.fn(() => Promise.resolve()) };
    const workflowSteps = { enqueueWorkflowWaitMatch: vi.fn(() => Promise.resolve()) };
    const event = staged();

    await publisher({ workflowTriggers, workflowSteps }).dispatch([event]);

    expect(workflowTriggers.enqueueWorkflowTrigger).toHaveBeenCalledWith(
      event.workflowDeliveries[0],
    );
    expect(workflowSteps.enqueueWorkflowWaitMatch).toHaveBeenCalledWith(event.waitCandidates[0]);
  });

  it('never throws: a lost enqueue is the sweeps’ to find', async () => {
    const logger = createCapturingLogger();
    const failing = () => Promise.reject(new Error('synthetic Valkey outage'));
    const workflowTriggers = { enqueueWorkflowTrigger: vi.fn(failing) };
    const workflowSteps = { enqueueWorkflowWaitMatch: vi.fn(failing) };
    const event = staged();

    await expect(
      publisher({ workflowTriggers, workflowSteps, logger }).dispatch([event]),
    ).resolves.toBeUndefined();

    expect(JSON.stringify(logger)).not.toContain('synthetic Valkey outage');
  });

  it('enqueues nothing without a scheduler', async () => {
    await expect(publisher().dispatch([staged()])).resolves.toBeUndefined();
  });

  it('takes an event staged before Workflow 8A, with nothing to enqueue', async () => {
    await expect(
      publisher().dispatch([{ eventId: newId('evt'), deliveries: [] }]),
    ).resolves.toBeUndefined();
  });
});
