import { describe, expect, it } from 'vitest';
import { createRecordingQueue } from '../jobs/testing.js';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
  createWebhookDeliveryScheduler,
  webhookDeliveryJobId,
  type WebhookDeliveryJob,
} from './queue.js';

const job: WebhookDeliveryJob = {
  environmentId: 'env_01M5CJXHG0000000000000000A',
  deliveryId: 'whd_01M5CK4VW0MRQ4HKKTBDT6PXEM',
  attempt: 3,
};

describe('webhook delivery queue', () => {
  it('uses the "webhook-delivery" queue', () => {
    expect(WEBHOOK_DELIVERY_QUEUE).toBe('webhook-delivery');
    expect(WEBHOOK_DELIVERY_JOB).toBe('deliver');
  });

  it('names a job after its delivery and attempt, so each attempt is enqueued once', () => {
    expect(webhookDeliveryJobId(job)).toBe('whd_01M5CK4VW0MRQ4HKKTBDT6PXEM-3');
    expect(webhookDeliveryJobId(job)).not.toContain(':');
  });

  it('adds a delayed job that BullMQ retries only for infrastructure errors', async () => {
    const queue = createRecordingQueue<WebhookDeliveryJob>();
    await createWebhookDeliveryScheduler(queue).scheduleDelivery(job, 60_000);
    expect(queue.jobs).toEqual([
      {
        name: 'deliver',
        data: job,
        options: {
          jobId: 'whd_01M5CK4VW0MRQ4HKKTBDT6PXEM-3',
          delay: 60_000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 },
          removeOnComplete: { age: 3_600, count: 10_000 },
          removeOnFail: { age: 604_800 },
        },
      },
    ]);
  });

  it('removes a job left under the same id before adding, when asked to replace it (2B F011)', async () => {
    const queue = createRecordingQueue<WebhookDeliveryJob>();
    const scheduler = createWebhookDeliveryScheduler(queue);

    await scheduler.scheduleDelivery(job, 0, { replace: true });
    await scheduler.scheduleDelivery({ ...job, attempt: 4 }, 60_000);

    expect(queue.removed).toEqual(['whd_01M5CK4VW0MRQ4HKKTBDT6PXEM-3']);
    expect(queue.jobs.map((entry) => entry.options?.jobId)).toEqual([
      'whd_01M5CK4VW0MRQ4HKKTBDT6PXEM-3',
      'whd_01M5CK4VW0MRQ4HKKTBDT6PXEM-4',
    ]);
  });

  it('runs a job without a delay at once and never schedules into the past', async () => {
    const queue = createRecordingQueue<WebhookDeliveryJob>();
    const scheduler = createWebhookDeliveryScheduler(queue);
    await scheduler.scheduleDelivery(job);
    await scheduler.scheduleDelivery(job, -5);
    expect(queue.jobs.map((entry) => entry.options?.delay)).toEqual([0, 0]);
  });

  it('closes its queue', async () => {
    const queue = createRecordingQueue<WebhookDeliveryJob>();
    await createWebhookDeliveryScheduler(queue).close();
    expect(queue.closed).toBe(true);
  });
});
