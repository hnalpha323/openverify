/**
 * The webhook delivery scheduler against BullMQ on Valkey 9.1 (Testcontainers): an attempt
 * whose job failed for good (BullMQ keeps failed jobs, and ignores an add under an id that still
 * exists) can be enqueued again by the dispatcher sweep (Workflow 2B F011).
 */
import { randomBytes } from 'node:crypto';
import { Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBullQueue } from '../jobs/queue.js';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
  createWebhookDeliveryScheduler,
  webhookDeliveryJobId,
  type WebhookDeliveryJob,
} from './queue.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;

let valkey: StartedTestContainer | undefined;
let connection: ConnectionOptions;
const prefix = `it-${randomBytes(4).toString('hex')}`;

beforeAll(async () => {
  valkey = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  connection = { host: valkey.getHost(), port: valkey.getMappedPort(6379) };
});

afterAll(async () => {
  await valkey?.stop();
});

/** Runs `job` once through a worker that always throws, until BullMQ marks it failed. */
async function failForGood(queue: Queue<WebhookDeliveryJob>, job: WebhookDeliveryJob) {
  // From the stream's start, not its end (`$`): the reader issues its first read after
  // `waitUntilReady`, so a job that fails before that read would never be seen, and under load the
  // test waited out its 60 s (Workflow 8B Stage 1b, integration shard 3 at a load of about 15).
  const events = new QueueEvents(WEBHOOK_DELIVERY_QUEUE, {
    connection,
    prefix,
    lastEventId: '0-0',
  });
  await events.waitUntilReady();
  const failed = new Promise<void>((resolve) => {
    events.on('failed', ({ jobId }) => {
      if (jobId === webhookDeliveryJobId(job)) {
        resolve();
      }
    });
  });
  // As after the scheduler's three attempts ran out during a database outage.
  await queue.add(WEBHOOK_DELIVERY_JOB, job, {
    jobId: webhookDeliveryJobId(job),
    attempts: 1,
    removeOnFail: { age: 7 * 24 * 3_600 },
  });
  const worker = new Worker<WebhookDeliveryJob>(
    WEBHOOK_DELIVERY_QUEUE,
    () => Promise.reject(new Error('the database is unavailable')),
    { connection, prefix },
  );
  await failed;
  await worker.close();
  await events.close();
}

describe('webhook delivery scheduler on BullMQ (2B F011)', () => {
  it('enqueues an attempt again over a job that failed for good, when the sweep replaces it', async () => {
    const inspect = new Queue<WebhookDeliveryJob>(WEBHOOK_DELIVERY_QUEUE, { connection, prefix });
    const scheduler = createWebhookDeliveryScheduler(
      createBullQueue<WebhookDeliveryJob>(WEBHOOK_DELIVERY_QUEUE, { connection, prefix }),
    );
    const job: WebhookDeliveryJob = {
      environmentId: 'env_01M5CJXHG0000000000000000A',
      deliveryId: 'whd_01M5CK4VW0MRQ4HKKTBDT6PXEM',
      attempt: 2,
    };
    await failForGood(inspect, job);

    // A plain add is a no-op: the failed job still holds the id.
    await scheduler.scheduleDelivery(job);
    expect(await inspect.getJobState(webhookDeliveryJobId(job))).toBe('failed');

    await scheduler.scheduleDelivery(job, 0, { replace: true });

    expect(await inspect.getJobState(webhookDeliveryJobId(job))).toBe('waiting');
    await scheduler.close();
    await inspect.close();
  });
});
