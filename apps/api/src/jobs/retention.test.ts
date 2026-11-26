/**
 * The daily `retention` BullMQ job (C16): its schedule, its processor and its worker, with fake
 * BullMQ classes so no Valkey is needed (the Testcontainers test runs it for real).
 */
import { newId } from '@openverify/contracts';
import { createApiLog, getApiLog, apiLogs, redactInquiryRecords, type Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import type { WorkerOptions } from 'bullmq';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedPiiSubject } from '../services/redaction.test-support.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { fixedClock } from '../test-support/fakes.js';
import type { WebhookDeliveryJob } from '../webhooks/queue.js';
import {
  RETENTION_JOB,
  RETENTION_JOB_OPTIONS,
  RETENTION_QUEUE,
  RETENTION_SCHEDULE,
  RETENTION_SCHEDULER_ID,
  retentionProcessor,
  scheduleRetention,
  startRetentionJob,
  type RetentionQueue,
  type RetentionWorker,
  type StartRetentionJobOptions,
} from './retention.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');

let database: TestDatabase;
let db: Db;
let environmentId: string;
let logged: { level: string; object: Record<string, unknown>; message: string }[];

const logger = {
  info: (object: Record<string, unknown>, message: string) =>
    logged.push({ level: 'info', object, message }),
  warn: (object: Record<string, unknown>, message: string) =>
    logged.push({ level: 'warn', object, message }),
  error: (object: Record<string, unknown>, message: string) =>
    logged.push({ level: 'error', object, message }),
};

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
});

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  logged = [];
});

async function oldApiLog(): Promise<string> {
  const log = await createApiLog(db, environmentId, {
    id: newId('alog'),
    method: 'GET',
    path: '/api/v1/inquiries',
    status: 200,
    durationMs: 1,
  });
  await db
    .update(apiLogs)
    .set({ createdAt: new Date(NOW.getTime() - 40 * 86_400_000) })
    .where(eq(apiLogs.id, log.id));
  return log.id;
}

interface FakeQueue extends RetentionQueue {
  name: string;
  options: unknown;
  schedulers: { id: string; repeat: unknown; template: unknown }[];
  closed: boolean;
}

function fakeQueue(name: string, options: unknown, failWith?: Error): FakeQueue {
  const queue: FakeQueue = {
    name,
    options,
    schedulers: [],
    closed: false,
    upsertJobScheduler(id, repeat, template) {
      if (failWith !== undefined) {
        return Promise.reject(failWith);
      }
      queue.schedulers.push({ id, repeat, template });
      return Promise.resolve();
    },
    close() {
      queue.closed = true;
      return Promise.resolve();
    },
  };
  return queue;
}

interface FakeWorker extends RetentionWorker {
  name: string;
  processor: (job: { id?: string }) => Promise<unknown>;
  options: WorkerOptions;
  listeners: Map<string, (...args: never[]) => void>;
  closed: boolean;
}

function harness(overrides: Partial<StartRetentionJobOptions> = {}) {
  const queues: FakeQueue[] = [];
  const workers: FakeWorker[] = [];
  const deliveries: { added: WebhookDeliveryJob[]; closed: boolean } = { added: [], closed: false };
  const options: StartRetentionJobOptions = {
    connection: { url: 'redis://127.0.0.1:1' },
    prefix: 'test',
    db,
    storage: createInMemoryFileStorage(),
    logger,
    clock: fixedClock(NOW),
    createQueue: (name, queueOptions) => {
      const queue = fakeQueue(name, queueOptions);
      queues.push(queue);
      return queue;
    },
    createDeliveryQueue: () => ({
      add: (_name, job) => {
        deliveries.added.push(job);
        return Promise.resolve();
      },
      close: () => {
        deliveries.closed = true;
        return Promise.resolve();
      },
    }),
    createWorker: (name, processor, workerOptions) => {
      const worker: FakeWorker = {
        name,
        processor,
        options: workerOptions,
        listeners: new Map(),
        closed: false,
        on(event: string, listener: (...args: never[]) => void) {
          worker.listeners.set(event, listener);
          return worker;
        },
        close() {
          worker.closed = true;
          return Promise.resolve();
        },
      };
      workers.push(worker);
      return worker;
    },
    ...overrides,
  };
  return { options, queues, workers, deliveries };
}

describe('the retention schedule', () => {
  it('runs daily at 03:00 UTC', () => {
    expect(RETENTION_QUEUE).toBe('retention');
    expect(RETENTION_JOB).toBe('retention');
    expect(RETENTION_SCHEDULE).toEqual({ pattern: '0 3 * * *', tz: 'UTC' });
  });

  it('upserts one job scheduler, so every worker that starts schedules the same job', async () => {
    const queue = fakeQueue(RETENTION_QUEUE, {});

    await scheduleRetention(queue);
    await scheduleRetention(queue, { every: 1_000 });

    expect(queue.schedulers).toEqual([
      {
        id: RETENTION_SCHEDULER_ID,
        repeat: RETENTION_SCHEDULE,
        template: { name: RETENTION_JOB, data: {}, opts: RETENTION_JOB_OPTIONS },
      },
      {
        id: RETENTION_SCHEDULER_ID,
        repeat: { every: 1_000 },
        template: { name: RETENTION_JOB, data: {}, opts: RETENTION_JOB_OPTIONS },
      },
    ]);
  });
});

describe('retentionProcessor', () => {
  it('runs the retention with the injected clock and logs the counts', async () => {
    const logId = await oldApiLog();
    const process = retentionProcessor({
      db,
      storage: createInMemoryFileStorage(),
      clock: fixedClock(NOW),
      logger,
      redaction: {
        redactInquiry: () => Promise.reject(new Error('unused')),
        redactAccount: () => Promise.reject(new Error('unused')),
        redactReport: () => Promise.reject(new Error('unused')),
        redactTransaction: () => Promise.reject(new Error('unused')),
        redactCase: () => Promise.reject(new Error('unused')),
      },
    });

    const report = await process({ id: 'job-1' });

    expect(report).toMatchObject({ deletedApiLogs: 1, redactedInquiries: 0 });
    expect(await getApiLog(db, environmentId, logId)).toBeNull();
    expect(logged).toContainEqual({
      level: 'info',
      message: 'retention run finished',
      object: expect.objectContaining({ deletedApiLogs: 1 }) as unknown,
    });
  });
});

describe('retentionProcessor with failures (2B F031)', () => {
  it('fails the job once the run is done when files of redacted inquiries could not be deleted, so BullMQ records and retries it', async () => {
    const storage = createInMemoryFileStorage();
    const subject = await seedPiiSubject({
      db,
      storage,
      keyring: database.keyring,
      environmentId,
    });
    // Redacted in the database, while storage still holds its files.
    await redactInquiryRecords(db, environmentId, subject.inquiryId);
    const logId = await oldApiLog();
    const process = retentionProcessor({
      db,
      storage: { ...storage, delete: () => Promise.reject(new Error('storage unavailable')) },
      clock: fixedClock(NOW),
      logger,
      redaction: {
        redactInquiry: () => Promise.reject(new Error('unused')),
        redactAccount: () => Promise.reject(new Error('unused')),
        redactReport: () => Promise.reject(new Error('unused')),
        redactTransaction: () => Promise.reject(new Error('unused')),
        redactCase: () => Promise.reject(new Error('unused')),
      },
    });

    await expect(process({ id: 'job-2' })).rejects.toMatchObject({
      name: 'RetentionIncompleteError',
    });
    // The rest of the run still happened.
    expect(await getApiLog(db, environmentId, logId)).toBeNull();
    expect(logged).toContainEqual({
      level: 'info',
      message: 'retention run finished',
      object: expect.objectContaining({ failedPurges: 2 }) as unknown,
    });
  });
});

describe('startRetentionJob', () => {
  it('schedules the job and starts one worker on the retention queue', async () => {
    const { options, queues, workers } = harness();

    const running = startRetentionJob(options);
    await running.ready;

    expect(queues.map((queue) => queue.name)).toEqual([RETENTION_QUEUE]);
    expect(queues[0]?.options).toEqual({
      connection: { url: 'redis://127.0.0.1:1' },
      prefix: 'test',
    });
    expect(queues[0]?.schedulers.map((scheduler) => scheduler.id)).toEqual([
      RETENTION_SCHEDULER_ID,
    ]);
    expect(workers.map((worker) => [worker.name, worker.options])).toEqual([
      [
        RETENTION_QUEUE,
        { connection: { url: 'redis://127.0.0.1:1' }, prefix: 'test', concurrency: 1 },
      ],
    ]);
    await running.close();
  });

  it('wires the worker to the retention run', async () => {
    const logId = await oldApiLog();
    const { options, workers } = harness();
    const running = startRetentionJob(options);

    const report = await workers[0]?.processor({ id: 'job-2' });

    expect(report).toMatchObject({ deletedApiLogs: 1 });
    expect(await getApiLog(db, environmentId, logId)).toBeNull();
    await running.close();
  });

  it('uses the given schedule', async () => {
    const { options, queues } = harness({ schedule: { every: 500 } });

    const running = startRetentionJob(options);
    await running.ready;

    expect(queues[0]?.schedulers[0]?.repeat).toEqual({ every: 500 });
    await running.close();
  });

  it('connects without a key prefix when none is given', async () => {
    const { options, queues, workers } = harness({ prefix: undefined });

    const running = startRetentionJob(options);

    expect(queues[0]?.options).toEqual({ connection: { url: 'redis://127.0.0.1:1' } });
    expect(workers[0]?.options).toEqual({
      connection: { url: 'redis://127.0.0.1:1' },
      concurrency: 1,
    });
    await running.close();
  });

  it('runs with the given redaction service and batch size', async () => {
    const calls: string[] = [];
    const { options, workers } = harness({
      batchSize: 1,
      redaction: {
        redactInquiry: (_ctx, id) => {
          calls.push(id);
          return Promise.resolve({ redactedAt: NOW, alreadyRedacted: false });
        },
        redactAccount: () => Promise.reject(new Error('unused')),
        redactReport: () => Promise.reject(new Error('unused')),
        redactTransaction: () => Promise.reject(new Error('unused')),
        redactCase: () => Promise.reject(new Error('unused')),
      },
    });
    const running = startRetentionJob(options);
    await oldApiLog();
    await oldApiLog();

    const report = await workers[0]?.processor({ id: 'job-4' });

    expect(report).toMatchObject({ deletedApiLogs: 2, redactedInquiries: 0 });
    expect(calls).toEqual([]);
    await running.close();
  });

  it('logs a scheduling failure instead of crashing the worker process', async () => {
    const { options } = harness({
      createQueue: (name, queueOptions) => fakeQueue(name, queueOptions, new Error('valkey down')),
    });

    const running = startRetentionJob(options);
    await running.ready;

    expect(logged).toContainEqual({
      level: 'error',
      message: 'retention job not scheduled',
      object: { queue: RETENTION_QUEUE, error: 'Error' },
    });
    await running.close();
  });

  it('logs failed jobs and worker errors with their class only', async () => {
    const { options, workers } = harness();
    const running = startRetentionJob(options);
    const worker = workers[0];

    const failed = worker?.listeners.get('failed') as
      ((job: { id?: string } | undefined, error: Error) => void) | undefined;
    const errored = worker?.listeners.get('error') as ((error: Error) => void) | undefined;
    failed?.({ id: 'job-3' }, new TypeError('secret detail'));
    errored?.(new RangeError('connection'));

    expect(logged).toEqual([
      {
        level: 'error',
        message: 'retention job failed',
        object: { queue: RETENTION_QUEUE, jobId: 'job-3', error: 'TypeError' },
      },
      {
        level: 'error',
        message: 'retention worker error',
        object: { queue: RETENTION_QUEUE, error: 'RangeError' },
      },
    ]);
    await running.close();
  });

  it('closes the worker, its queue and the delivery queue', async () => {
    const { options, queues, workers, deliveries } = harness();
    const running = startRetentionJob(options);

    await running.close();

    expect(workers[0]?.closed).toBe(true);
    expect(queues[0]?.closed).toBe(true);
    expect(deliveries.closed).toBe(true);
  });
});
