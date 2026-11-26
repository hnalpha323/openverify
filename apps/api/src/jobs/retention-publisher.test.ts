/**
 * C118.1, C119.3 (F02; Workflow 8A Stage 1b (E)): the retention job's construction site. Redacting an
 * object stages events, so its publisher wakes deliveries and wait candidates too, and closes the
 * queues it opened.
 */
import type { Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryFileStorage } from '../storage/index.js';
import type { WebhookDeliveryJob } from '../webhooks/queue.js';
import { createCapturingLogger, createRecordingQueue } from './testing.js';
import { startRetentionJob, type RetentionQueue, type RetentionWorker } from './retention.js';

const publisher = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('../events/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../events/index.js')>();
  return {
    ...actual,
    createEventPublisher: (options: Parameters<typeof actual.createEventPublisher>[0]) => {
      publisher.options.push(options);
      return actual.createEventPublisher(options);
    },
  };
});

const fake = (member: string) => ({
  [member]: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
});

describe('startRetentionJob: the event publisher’s schedulers (F02)', () => {
  it('passes them, and closes them', async () => {
    publisher.options.length = 0;
    const workflowTriggers = fake('enqueueWorkflowTrigger');
    const workflowWaitMatches = fake('enqueueWorkflowWaitMatch');
    const listRescreens = fake('enqueueListRescreen');
    const queue: RetentionQueue = {
      upsertJobScheduler: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    const worker: RetentionWorker = {
      on: () => worker,
      close: () => Promise.resolve(),
    };

    const running = startRetentionJob({
      connection: { url: 'redis://127.0.0.1:1' },
      db: {} as Db,
      storage: createInMemoryFileStorage(),
      logger: createCapturingLogger(),
      createQueue: () => queue,
      createDeliveryQueue: () => createRecordingQueue<WebhookDeliveryJob>(),
      createWorker: () => worker,
      workflowTriggers: workflowTriggers as never,
      workflowWaitMatches: workflowWaitMatches as never,
      listRescreens: listRescreens as never,
    });

    expect(publisher.options[0]).toMatchObject({
      workflowTriggers,
      workflowSteps: workflowWaitMatches,
      listRescreens,
    });

    await running.close();
    expect(workflowTriggers.close).toHaveBeenCalled();
    expect(workflowWaitMatches.close).toHaveBeenCalled();
    expect(listRescreens.close).toHaveBeenCalled();
  });
});
