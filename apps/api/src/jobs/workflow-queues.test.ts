/**
 * C117.8, C117.9, C118.1, C119.3, C143.2 (Workflow 8A Stage 1b (E)): the engine's producers. A job
 * carries ids alone, a step's job id is `<step id>-<attempt>`, and every job goes when it finishes,
 * because BullMQ ignores an `add` under an id it still holds (the left-over-id trap).
 */
import { newId } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  PUBLISHER_RIGHTS_INTERVAL_MS,
  PUBLISHER_RIGHTS_QUEUE,
  WORKFLOW_SCHEDULED_RUNS_QUEUE,
  WORKFLOW_SCHEDULE_SWEEP_QUEUE,
  WORKFLOW_STEP_BATCH_QUEUE,
  WORKFLOW_STEP_QUEUE,
  WORKFLOW_STEP_SWEEP_QUEUE,
  WORKFLOW_SWEEP_INTERVAL_MS,
  WORKFLOW_TRIGGER_QUEUE,
  WORKFLOW_TRIGGER_SWEEP_QUEUE,
  WORKFLOW_WAIT_MATCH_QUEUE,
  WORKFLOW_WAIT_MATCH_SWEEP_QUEUE,
  createWorkflowStepQueue,
  createWorkflowTriggerQueue,
  createWorkflowWaitMatchQueue,
} from './workflow-queues.js';

function fakeQueue() {
  return {
    add: vi.fn<(...args: [string, unknown, unknown]) => Promise<void>>(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

const environmentId = newId('env');
const step = () => ({
  environmentId,
  runId: newId('wfr'),
  stepId: newId('wfst'),
  attempt: 2,
});

describe('the engine’s names (C143.1, C143.2)', () => {
  it('are the plan’s', () => {
    expect([
      WORKFLOW_STEP_QUEUE,
      WORKFLOW_STEP_BATCH_QUEUE,
      WORKFLOW_TRIGGER_QUEUE,
      WORKFLOW_WAIT_MATCH_QUEUE,
    ]).toEqual(['workflow-step', 'workflow-step-batch', 'workflow-trigger', 'workflow-wait-match']);
    expect([
      WORKFLOW_STEP_SWEEP_QUEUE,
      WORKFLOW_TRIGGER_SWEEP_QUEUE,
      WORKFLOW_WAIT_MATCH_SWEEP_QUEUE,
      WORKFLOW_SCHEDULE_SWEEP_QUEUE,
      WORKFLOW_SCHEDULED_RUNS_QUEUE,
      PUBLISHER_RIGHTS_QUEUE,
    ]).toEqual([
      'workflow-step-sweep',
      'workflow-trigger-sweep',
      'workflow-wait-match-sweep',
      'workflow-schedule-sweep',
      'workflow-scheduled-runs',
      'publisher-rights',
    ]);
    expect([WORKFLOW_SWEEP_INTERVAL_MS, PUBLISHER_RIGHTS_INTERVAL_MS]).toEqual([15_000, 60_000]);
  });
});

describe('the step producer (C117.8, C117.9)', () => {
  it('sends an interactive step to workflow-step, its id the step and the attempt', async () => {
    const interactive = fakeQueue();
    const batch = fakeQueue();
    const queue = createWorkflowStepQueue({ step: interactive, batch });
    const job = step();

    await queue.enqueueWorkflowStep(job);

    expect(batch.add).not.toHaveBeenCalled();
    expect(interactive.add).toHaveBeenCalledWith(
      WORKFLOW_STEP_QUEUE,
      job,
      expect.objectContaining({
        jobId: `${job.stepId}-2`,
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });

  it('sends a batch step to workflow-step-batch', async () => {
    const interactive = fakeQueue();
    const batch = fakeQueue();

    await createWorkflowStepQueue({ step: interactive, batch }).enqueueWorkflowStep(step(), {
      batch: true,
    });

    expect(interactive.add).not.toHaveBeenCalled();
    expect(batch.add).toHaveBeenCalledTimes(1);
  });

  it('delays a step that is due within the hour', async () => {
    const interactive = fakeQueue();

    await createWorkflowStepQueue({ step: interactive, batch: fakeQueue() }).enqueueWorkflowStep(
      step(),
      { delayMs: 5_000 },
    );

    expect(interactive.add.mock.calls[0]?.[2]).toMatchObject({ delay: 5_000 });
  });

  it('refuses a job with no ids, before anything reaches Valkey', async () => {
    const interactive = fakeQueue();
    const queue = createWorkflowStepQueue({ step: interactive, batch: fakeQueue() });

    await expect(queue.enqueueWorkflowStep({ ...step(), stepId: 'not an id' })).rejects.toThrow(
      TypeError,
    );
    expect(interactive.add).not.toHaveBeenCalled();
  });

  it('carries nothing but its ids', async () => {
    const interactive = fakeQueue();
    const job = step();

    await createWorkflowStepQueue({ step: interactive, batch: fakeQueue() }).enqueueWorkflowStep({
      ...job,
      value: 'synthetic',
    } as typeof job);

    expect(interactive.add.mock.calls[0]?.[1]).toEqual(job);
  });

  it('closes both queues', async () => {
    const interactive = fakeQueue();
    const batch = fakeQueue();

    await createWorkflowStepQueue({ step: interactive, batch }).close();

    expect(interactive.close).toHaveBeenCalledTimes(1);
    expect(batch.close).toHaveBeenCalledTimes(1);
  });
});

describe('the trigger producer (C118.1)', () => {
  it('enqueues one job per delivery, its id the delivery', async () => {
    const queue = fakeQueue();
    const job = { environmentId, deliveryId: newId('wftd') };

    await createWorkflowTriggerQueue({ queue }).enqueueWorkflowTrigger(job);

    expect(queue.add).toHaveBeenCalledWith(
      WORKFLOW_TRIGGER_QUEUE,
      job,
      expect.objectContaining({
        jobId: job.deliveryId,
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });

  it('refuses another id', async () => {
    await expect(
      createWorkflowTriggerQueue({ queue: fakeQueue() }).enqueueWorkflowTrigger({
        environmentId,
        deliveryId: newId('wfr'),
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe('the wait-match producer (C119.3)', () => {
  it('enqueues one job per candidate, its id the event', async () => {
    const queue = fakeQueue();
    const job = { environmentId, eventId: newId('evt') };

    await createWorkflowWaitMatchQueue({ queue }).enqueueWorkflowWaitMatch(job);

    expect(queue.add).toHaveBeenCalledWith(
      WORKFLOW_WAIT_MATCH_QUEUE,
      job,
      expect.objectContaining({ jobId: job.eventId, removeOnComplete: true, removeOnFail: true }),
    );
  });

  it('refuses another id', async () => {
    await expect(
      createWorkflowWaitMatchQueue({ queue: fakeQueue() }).enqueueWorkflowWaitMatch({
        environmentId,
        eventId: newId('wfr'),
      }),
    ).rejects.toThrow(TypeError);
  });
});
