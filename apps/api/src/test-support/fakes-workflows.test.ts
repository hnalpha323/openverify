/**
 * Workflow 8A (C117.9, C118.1, C119.3): the recording fakes of the engine's producers, which each
 * Stage 3 suite uses instead of Valkey.
 */
import { describe, expect, it } from 'vitest';
import {
  createRecordingWorkflowStepQueue,
  createRecordingWorkflowTriggerQueue,
  createRecordingWorkflowWaitMatchQueue,
} from './fakes.js';

describe('the engine’s recording producers', () => {
  it('record a step with how it was enqueued', async () => {
    const queue = createRecordingWorkflowStepQueue();
    const job = { environmentId: 'env_1', runId: 'wfr_1', stepId: 'wfst_1', attempt: 1 };

    await queue.enqueueWorkflowStep(job);
    await queue.enqueueWorkflowStep(job, { batch: true });

    expect(queue.jobs).toEqual([
      { job, options: {} },
      { job, options: { batch: true } },
    ]);
  });

  it('record a delivery', async () => {
    const queue = createRecordingWorkflowTriggerQueue();
    const job = { environmentId: 'env_1', deliveryId: 'wftd_1' };

    await queue.enqueueWorkflowTrigger(job);

    expect(queue.jobs).toEqual([job]);
  });

  it('record a wait candidate', async () => {
    const queue = createRecordingWorkflowWaitMatchQueue();
    const job = { environmentId: 'env_1', eventId: 'evt_1' };

    await queue.enqueueWorkflowWaitMatch(job);

    expect(queue.jobs).toEqual([job]);
  });
});
