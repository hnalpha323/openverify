import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createSelfieCapture,
  createVerification,
  encryptBytes,
  files,
  getInquiry,
  getVerification,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { DomainError } from '@openverify/core';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { DrizzleQueryError } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import {
  ConfigError,
  NO_NETWORK_SETTINGS,
  type ReportLimits,
  type WatchlistSettings,
} from './config.js';
import { createEventPublisher } from './events/index.js';
import { createWorkerLogger } from './jobs/logger.js';
import { PermanentJobError } from './jobs/process-verification.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { ReportRunJob, VisionClient } from './ports.js';
import { NO_PROVIDERS, createProviderBindings } from './providers/index.js';
import { syntheticEnv } from './test-support/env.js';
import {
  createInMemoryNetworkSnapshots,
  createAllowAllRateLimiter,
  createFakeDnsResolver,
  createInMemoryKeyValueCache,
  createRecordingQueue as createRecordingVerificationQueue,
  createRecordingReportRescreenQueue,
  createRecordingReportRunQueue,
  createRefusingOutboundHttp,
} from './test-support/fakes.js';
import { nfcSelfTest } from './jobs/types/government-id-nfc.js';
import type * as GovernmentIdNfcJob from './jobs/types/government-id-nfc.js';
import { VisionResponseError, VisionUnavailableError } from './vision/index.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from './webhooks/queue.js';
import { WebhookNetworkConfigError } from './webhooks/ssrf.js';
import {
  main,
  processVerificationProcessor,
  reportRescreenProcessor,
  reportRunProcessor,
  startWorkers,
  webhookDeliveryProcessor,
  type FakeableWorker,
  type ReportRunWorkerDeps,
  type WorkerReportOptions,
  type RepeatableQueue,
  type StartWorkersOptions,
  type WorkerProcessor,
} from './worker.js';

// C62.9: the worker runs the platform self-test at start; the spy keeps the real, memoised test.
vi.mock('./jobs/types/government-id-nfc.js', async (importOriginal) => {
  const original = await importOriginal<typeof GovernmentIdNfcJob>();
  return { ...original, nfcSelfTest: vi.fn(original.nfcSelfTest) };
});

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

const unusedVision: VisionClient = {
  analyzeGovernmentId: () => Promise.reject(new Error('unused')),
  analyzeSelfie: () => Promise.reject(new Error('unused')),
  embedFace: () => Promise.reject(new Error('unused')),
  compareBackground: () => Promise.reject(new Error('unused')),
  analyzeDocument: () => Promise.reject(new Error('unused')),
  renderDocumentPage: () => Promise.reject(new Error('unused')),
  convertPortrait: () => Promise.reject(new Error('unused')),
  maskBackground: () => Promise.reject(new Error('unused')),
  createRendition: () => Promise.reject(new Error('unused')),
};

const unusedSender: WebhookSender = {
  send: () => Promise.reject(new Error('unused')),
  close: () => Promise.resolve(),
};

interface FakeWorker extends FakeableWorker {
  name: string;
  processor: WorkerProcessor;
  options: WorkerOptions;
  listeners: Map<string, (...args: never[]) => void>;
  closed: boolean;
}

interface FakeRepeatableQueue extends RepeatableQueue {
  name: string;
  schedules: { id: string; repeat: unknown; template: unknown }[];
  closed: boolean;
}

function harness(overrides: Partial<StartWorkersOptions> = {}) {
  const workers: FakeWorker[] = [];
  const repeatableQueues: FakeRepeatableQueue[] = [];
  const queue = createRecordingQueue<WebhookDeliveryJob>();
  const logger = createCapturingLogger();
  const options: StartWorkersOptions = {
    connection: { url: 'redis://127.0.0.1:1' },
    prefix: 'test',
    db,
    storage: createMemoryStorage(),
    keyring: database.keyring,
    vision: unusedVision,
    sender: unusedSender,
    logger,
    concurrency: 3,
    sweepIntervalMs: 0,
    createQueue: (name) => {
      expect(name).toBe('webhook-delivery');
      return queue;
    },
    createRepeatableQueue: (name) => {
      const repeatable: FakeRepeatableQueue = {
        name,
        schedules: [],
        closed: false,
        upsertJobScheduler(id, repeat, template) {
          repeatable.schedules.push({ id, repeat, template });
          return Promise.resolve();
        },
        close() {
          repeatable.closed = true;
          return Promise.resolve();
        },
      };
      repeatableQueues.push(repeatable);
      return repeatable;
    },
    createWorker: (name, processor, workerOptions) => {
      const worker: FakeWorker = {
        name,
        processor: processor as WorkerProcessor,
        options: workerOptions,
        listeners: new Map(),
        closed: false,
        on(event, listener) {
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
  return { options, workers, queue, logger, repeatableQueues };
}

describe('processVerificationProcessor', () => {
  const deps = () => {
    const { options } = harness();
    return {
      ...options,
      clock: { now: () => new Date() },
      events: createEventPublisher({
        db,
        deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
      }),
    };
  };

  it('returns the processing result', async () => {
    const processor = processVerificationProcessor({
      ...deps(),
      process: () => Promise.resolve({ outcome: 'skipped', reason: 'not_found' }),
    });
    expect(
      await processor({ id: 'ver_X', data: { environmentId, verificationId: newId('ver') } }),
    ).toEqual({ outcome: 'skipped', reason: 'not_found' });
  });

  it.each([
    [new PermanentJobError('file_missing'), 'The job cannot succeed (file_missing)'],
    [
      new VisionResponseError('/v1/analyze/selfie', []),
      'Vision service response does not match the contract (/v1/analyze/selfie)',
    ],
  ])('turns a permanent failure into an UnrecoverableError', async (error, message) => {
    const processor = processVerificationProcessor({
      ...deps(),
      process: () => Promise.reject(error),
    });
    const thrown = await processor({
      id: 'j',
      data: { environmentId, verificationId: 'ver_X' },
    }).catch((caught: unknown) => caught);
    expect(thrown).toBeInstanceOf(UnrecoverableError);
    expect((thrown as Error).message).toBe(message);
  });

  it.each([
    [new ZodError([]), 'ZodError: data does not satisfy a contract'],
    [new DomainError('invalid_face_embedding', 'detail'), 'DomainError: invalid_face_embedding'],
  ])('describes %s by its class and code only', async (error, message) => {
    const processor = processVerificationProcessor({
      ...deps(),
      process: () => Promise.reject(error),
    });
    await expect(
      processor({ id: 'j', data: { environmentId, verificationId: 'ver_X' } }),
    ).rejects.toThrow(new UnrecoverableError(message));
  });

  it('rethrows a transient failure so BullMQ retries it', async () => {
    const outage = new VisionUnavailableError('/v1/analyze/selfie', 'network');
    const processor = processVerificationProcessor({
      ...deps(),
      process: () => Promise.reject(outage),
    });
    await expect(
      processor({ id: 'j', data: { environmentId, verificationId: 'ver_X' } }),
    ).rejects.toBe(outage);
  });

  /** A submitted ID verification on a pending default-template inquiry. */
  async function submittedVerification() {
    const defaults = defaultInquiryTemplateAttributes();
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    const verificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: verificationId,
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
    return { inquiryId: inquiry.id, verificationId };
  }

  const statuses = async (ids: { inquiryId: string; verificationId: string }) => [
    (await getVerification(db, environmentId, ids.verificationId))?.status,
    (await getInquiry(db, environmentId, ids.inquiryId))?.status,
  ];

  it('fails the verification and its inquiry on a permanent failure, without a retry', async () => {
    const ids = await submittedVerification();
    const processor = processVerificationProcessor({
      ...deps(),
      process: () => Promise.reject(new PermanentJobError('file_missing')),
    });

    const thrown = await processor({
      id: ids.verificationId,
      data: { environmentId, verificationId: ids.verificationId },
      attemptsMade: 0,
      opts: { attempts: 5 },
    }).catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(UnrecoverableError);
    expect(await statuses(ids)).toEqual(['failed', 'failed']);
  });

  it('fails the verification once the last attempt of a transient failure fails', async () => {
    const ids = await submittedVerification();
    const outage = new VisionUnavailableError('/v1/analyze/government-id', 'timeout');
    const processor = processVerificationProcessor({
      ...deps(),
      process: () => Promise.reject(outage),
    });
    const attempt = (attemptsMade: number) =>
      processor({
        id: ids.verificationId,
        data: { environmentId, verificationId: ids.verificationId },
        attemptsMade,
        opts: { attempts: 5 },
      });

    await expect(attempt(3)).rejects.toBe(outage);
    expect(await statuses(ids)).toEqual(['submitted', 'pending']);
    await expect(attempt(4)).rejects.toBe(outage);
    expect(await statuses(ids)).toEqual(['failed', 'failed']);
  });

  it('tells the job whether this is its last attempt (C30.3)', async () => {
    const seen: (boolean | undefined)[] = [];
    const processor = processVerificationProcessor({
      ...deps(),
      process: (_job, _deps, options) => {
        seen.push(options?.lastAttempt);
        return Promise.resolve({ outcome: 'skipped', reason: 'not_found' });
      },
    });
    const data = { environmentId, verificationId: newId('ver') };

    await processor({ id: 'j', data, attemptsMade: 3, opts: { attempts: 5 } });
    await processor({ id: 'j', data, attemptsMade: 4, opts: { attempts: 5 } });
    await processor({ id: 'j', data });

    expect(seen).toEqual([false, true, true]);
  });

  it('processes against the database by default', async () => {
    const processor = processVerificationProcessor(deps());
    expect(
      await processor({ id: 'j', data: { environmentId, verificationId: newId('ver') } }),
    ).toEqual({ outcome: 'skipped', reason: 'not_found' });
  });
});

describe('webhookDeliveryProcessor', () => {
  it('delivers through the dispatcher', async () => {
    const { options } = harness();
    const processor = webhookDeliveryProcessor({
      ...options,
      scheduler: { scheduleDelivery: () => Promise.resolve() },
      clock: { now: () => new Date() },
    });
    expect(
      await processor({
        id: 'j',
        data: { environmentId, deliveryId: newId('whd'), attempt: 1 },
      }),
    ).toEqual({ outcome: 'skipped', reason: 'not_found' });
  });
});

describe('startWorkers', () => {
  it('starts one worker per queue with the connection, prefix and concurrency', async () => {
    const { options, workers } = harness();
    const running = startWorkers(options);
    expect(workers.map((worker) => worker.name)).toEqual([
      'process-verification',
      'webhook-delivery',
      'inquiry-expiry',
    ]);
    for (const worker of workers.slice(0, 2)) {
      expect(worker.options).toEqual({
        connection: { url: 'redis://127.0.0.1:1' },
        prefix: 'test',
        concurrency: 3,
      });
    }
    await running.close();
  });

  it('wires each processor to its job', async () => {
    const { options, workers } = harness();
    const running = startWorkers(options);
    const [verifications, deliveries] = workers;
    expect(
      await verifications?.processor({
        id: 'j1',
        data: { environmentId, verificationId: newId('ver') },
      }),
    ).toEqual({ outcome: 'skipped', reason: 'not_found' });
    expect(
      await deliveries?.processor({
        id: 'j2',
        data: { environmentId, deliveryId: newId('whd'), attempt: 1 },
      }),
    ).toEqual({ outcome: 'skipped', reason: 'not_found' });
    await running.close();
  });

  it('gives the verification job the blind index key and the providers (C31.8, C35)', async () => {
    const providers = createProviderBindings({
      sandbox: { aamva: 'sandbox', publicFigure: null, ageEstimate: null },
      production: NO_PROVIDERS.production,
    });
    const blindIndexKey = new Uint8Array(32).fill(9);
    const received: unknown[] = [];
    const { options, workers } = harness({
      blindIndexKey,
      providers,
      processVerification: (_job, jobDeps) => {
        received.push(jobDeps);
        return Promise.resolve({ outcome: 'skipped', reason: 'not_found' });
      },
    });
    const running = startWorkers(options);

    await workers[0]?.processor({ id: 'j', data: { environmentId, verificationId: 'ver_X' } });

    expect(received).toEqual([expect.objectContaining({ blindIndexKey, providers })]);
    await running.close();
  });

  it('gives the verification job the cache, outbound client, DNS resolver, limiter and queue (C54.3, C59.6)', async () => {
    const cache = createInMemoryKeyValueCache();
    const outboundHttp = createRefusingOutboundHttp();
    const dnsResolver = createFakeDnsResolver();
    const rateLimiter = createAllowAllRateLimiter();
    const verificationQueue = createRecordingVerificationQueue();
    const received: unknown[] = [];
    const { options, workers } = harness({
      cache,
      outboundHttp,
      dnsResolver,
      rateLimiter,
      verificationQueue,
      processVerification: (_job, jobDeps) => {
        received.push(jobDeps);
        return Promise.resolve({ outcome: 'skipped', reason: 'not_found' });
      },
    });
    const running = startWorkers(options);

    await workers[0]?.processor({ id: 'j', data: { environmentId, verificationId: 'ver_X' } });

    expect(received).toEqual([
      expect.objectContaining({
        cache,
        outboundHttp,
        dnsResolver,
        rateLimiter,
        queue: verificationQueue,
      }),
    ]);
    await running.close();
  });

  it('logs failed jobs and worker errors with ids only', async () => {
    const { options, workers, logger } = harness();
    const running = startWorkers(options);
    const failed = workers[0]?.listeners.get('failed') as (job: unknown, error: Error) => void;
    failed(
      {
        id: 'ver_01',
        name: 'process-verification',
        data: { environmentId, verificationId: 'ver_01' },
        attemptsMade: 5,
        opts: { attempts: 5 },
      },
      new VisionUnavailableError('/v1/analyze/selfie', 'network'),
    );
    // The message of an error of unknown origin is left out: it can carry data (H001).
    failed(undefined, new Error('lost'));
    (workers[1]?.listeners.get('error') as (error: Error) => void)(new Error('ECONNREFUSED'));
    expect(logger.entries).toEqual([
      {
        level: 'error',
        object: {
          queue: 'process-verification',
          jobId: 'ver_01',
          attemptsMade: 5,
          final: true,
          error: 'VisionUnavailableError',
          detail: 'Vision service unreachable (/v1/analyze/selfie)',
        },
        message: 'job failed',
      },
      {
        level: 'error',
        object: {
          queue: 'process-verification',
          jobId: null,
          attemptsMade: null,
          final: true,
          error: 'Error',
          detail: 'Error',
        },
        message: 'job failed',
      },
      {
        level: 'error',
        object: { queue: 'webhook-delivery', error: 'Error' },
        message: 'worker error',
      },
    ]);
    await running.close();
  });

  it('sweeps overdue webhook deliveries on an interval', async () => {
    vi.useFakeTimers();
    try {
      const { options, logger } = harness({ sweepIntervalMs: 1_000 });
      const sweep = vi.fn(() => Promise.resolve(2));
      const running = startWorkers({ ...options, sweep });
      await vi.advanceTimersByTimeAsync(2_500);
      expect(sweep).toHaveBeenCalledTimes(2);
      sweep.mockRejectedValueOnce(new Error('database down'));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(logger.entries).toContainEqual(
        expect.objectContaining({ level: 'warn', message: 'webhook sweep failed' }),
      );
      await running.close();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(sweep).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the workers and the delivery queue', async () => {
    const { options, workers, queue } = harness();
    await startWorkers(options).close();
    expect(workers.every((worker) => worker.closed)).toBe(true);
    expect(queue.closed).toBe(true);
  });
});

describe('startWorkers: a failed job carries no data (Workflow 4B review H001)', () => {
  /**
   * A query that failed: Drizzle's error puts every parameter into its message, here a synthetic
   * background layout and a synthetic email address.
   */
  const queryFailure = () =>
    new DrizzleQueryError(
      'select "id" from "selfie_backgrounds" order by "layout" <-> $1 limit $2',
      ['[37.123,37.123,37.123]', 'person@example.test'],
      Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
        severity: 'ERROR',
      }),
    );
  const DESCRIBED = 'DrizzleQueryError: the query failed (SQLSTATE 57014)';
  const leaks = (text: string) => text.includes('37.123') || text.includes('person@example.test');

  it.each([
    ['process-verification', 0],
    ['webhook-delivery', 1],
    ['inquiry-expiry', 2],
  ])(
    'the %s processor rethrows a failure to BullMQ (failedReason, stack trace) without its data',
    async (_queue, index) => {
      const { options, workers } = harness({
        processVerification: () => Promise.reject(queryFailure()),
        expireInquiries: () => Promise.reject(queryFailure()),
        // The webhook delivery's first read fails.
        db: new Proxy(db, {
          get: (target, key) =>
            key === 'select'
              ? () => {
                  throw queryFailure();
                }
              : (Reflect.get(target, key) as unknown),
        }),
      });
      const running = startWorkers(options);

      const thrown: unknown = await workers[index]
        ?.processor({
          id: 'j',
          data: { environmentId, verificationId: 'ver_X', deliveryId: 'whd_X', attempt: 1 },
          attemptsMade: 0,
          opts: { attempts: 5 },
        })
        .catch((caught: unknown) => caught);

      expect(thrown).toBeInstanceOf(Error);
      const error = thrown as Error;
      expect(leaks(`${error.message}\n${error.stack ?? ''}`)).toBe(false);
      expect(error.message).toBe(DESCRIBED);
      expect(error).not.toBeInstanceOf(UnrecoverableError);
      await running.close();
    },
  );

  it('still fails a permanent failure for good through the same path', async () => {
    const { options, workers } = harness({
      processVerification: () => Promise.reject(new PermanentJobError('file_missing')),
    });
    const running = startWorkers(options);

    const thrown: unknown = await workers[0]
      ?.processor({ id: 'j', data: { environmentId, verificationId: 'ver_X' } })
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(UnrecoverableError);
    expect((thrown as Error).message).toBe('The job cannot succeed (file_missing)');
    await running.close();
  });

  it('logs a failed job with its class and SQLSTATE, never its message', async () => {
    const lines: string[] = [];
    const logger = createWorkerLogger({
      destination: new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString('utf8'));
          callback();
        },
      }),
    });
    const { options, workers } = harness({ logger });
    const running = startWorkers(options);
    const failed = workers[0]?.listeners.get('failed') as (job: unknown, error: Error) => void;

    failed({ id: 'ver_01', attemptsMade: 5, opts: { attempts: 5 } }, queryFailure());

    expect(lines).toHaveLength(1);
    expect(leaks(lines.join(''))).toBe(false);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      queue: 'process-verification',
      jobId: 'ver_01',
      final: true,
      detail: DESCRIBED,
      msg: 'job failed',
    });
    await running.close();
  });
});

describe('startWorkers: repeatable jobs (C10 inquiry-expiry)', () => {
  it('schedules inquiry-expiry every 60 seconds on its own queue and worker', async () => {
    const { options, workers, repeatableQueues } = harness();
    const running = startWorkers(options);
    await Promise.resolve();

    expect(repeatableQueues.map((queue) => [queue.name, queue.schedules])).toEqual([
      [
        'inquiry-expiry',
        [{ id: 'inquiry-expiry', repeat: { every: 60_000 }, template: { name: 'inquiry-expiry' } }],
      ],
    ]);
    const expiry = workers.find((worker) => worker.name === 'inquiry-expiry');
    expect(expiry?.options).toEqual({
      connection: { url: 'redis://127.0.0.1:1' },
      prefix: 'test',
      concurrency: 1,
    });
    await running.close();
    expect(repeatableQueues.every((queue) => queue.closed)).toBe(true);
  });

  it('runs the expiry sweep when the scheduled job arrives', async () => {
    const result = { expiredInquiries: 2, expiredSessions: 1, failedInquiries: 0 };
    const expireInquiries = vi.fn(() => Promise.resolve(result));
    const { options, workers } = harness({ expireInquiries });
    const running = startWorkers(options);

    const expiry = workers.find((worker) => worker.name === 'inquiry-expiry');
    expect(await expiry?.processor({ id: 'repeat:1', data: {} })).toEqual(result);
    expect(expireInquiries).toHaveBeenCalledTimes(1);
    await running.close();
  });

  it('sweeps the database by default', async () => {
    const { options, workers } = harness();
    const running = startWorkers(options);

    const expiry = workers.find((worker) => worker.name === 'inquiry-expiry');
    expect(await expiry?.processor({ id: 'repeat:2', data: {} })).toMatchObject({
      failedInquiries: 0,
    });
    await running.close();
  });

  it("deletes, with the worker's storage, the objects of the capture files an expiry deletes (K201)", async () => {
    const { options, workers } = harness();
    const defaults = defaultInquiryTemplateAttributes();
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    await database.client.query('update inquiries set expires_at = $2 where id = $1', [
      inquiry.id,
      new Date(Date.now() - 60_000),
    ]);
    const verificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: verificationId,
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    const captureId = newId('self');
    await createSelfieCapture(db, environmentId, {
      id: captureId,
      verificationId,
      inquiryId: inquiry.id,
      method: 'camera',
      liveness: 'active',
      prompts: ['center', 'left', 'right'],
      nonceSha256: randomBytes(32),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 180_000),
    });
    // The centre pose, uploaded under the open capture (synthetic bytes).
    const fileId = newId('file');
    const storageKey = `${environmentId}/${fileId}`;
    const bytes = randomBytes(16);
    const sealed = encryptBytes(bytes, database.keyring, { context: fileId });
    await options.storage.put(storageKey, sealed.ciphertext);
    await db.insert(files).values({
      id: fileId,
      environmentId,
      verificationId,
      kind: 'selfie-center',
      storageKey,
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      wrappedDek: sealed.wrappedDek,
      selfieCaptureId: captureId,
      clientElapsedMs: 1500,
      receivedAt: new Date(),
    });
    const running = startWorkers(options);

    const expiry = workers.find((worker) => worker.name === 'inquiry-expiry');
    await expiry?.processor({ id: 'repeat:3', data: {} });

    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('expired');
    expect(await options.storage.get(storageKey)).toBeNull();
    await running.close();
  });

  it('logs a schedule that cannot be written, with the queue name only', async () => {
    const { options, logger } = harness();
    const running = startWorkers({
      ...options,
      createRepeatableQueue: () => ({
        upsertJobScheduler: () => Promise.reject(new Error('valkey down')),
        close: () => Promise.resolve(),
      }),
    });
    await vi.waitFor(() => {
      expect(logger.entries).toContainEqual({
        level: 'error',
        object: { queue: 'inquiry-expiry', error: 'Error' },
        message: 'repeatable job not scheduled',
      });
    });
    await running.close();
  });
});

describe('startWorkers: the Phase 5 repeatable jobs (C54.1, C61.5, C62.7)', () => {
  const oneFeed = {
    schema_version: 1 as const,
    feeds: [
      {
        id: 'synthetic-phishing',
        url: 'https://feeds.example.test/phishing.txt',
        format: 'domains' as const,
        category: 'phishing' as const,
        refresh_interval_seconds: 3600,
        terms: 'Synthetic test feed.',
      },
    ],
  };

  it('schedules the feed and trust refreshes after inquiry-expiry once they are turned on', async () => {
    const { options, workers, repeatableQueues } = harness({
      maliciousFeeds: oneFeed,
      nfc: { allowIcaoCrls: false, trustAnchorRefresh: true },
    });
    const running = startWorkers(options);
    await Promise.resolve();

    expect(repeatableQueues.map((queue) => [queue.name, queue.schedules])).toEqual([
      [
        'inquiry-expiry',
        [{ id: 'inquiry-expiry', repeat: { every: 60_000 }, template: { name: 'inquiry-expiry' } }],
      ],
      [
        'malicious-feed-refresh',
        [
          {
            id: 'malicious-feed-refresh',
            repeat: { every: 300_000 },
            template: { name: 'malicious-feed-refresh' },
          },
        ],
      ],
      [
        'trust-anchor-refresh',
        [
          {
            id: 'trust-anchor-refresh',
            repeat: { every: 21_600_000 },
            template: { name: 'trust-anchor-refresh' },
          },
        ],
      ],
    ]);
    for (const name of ['malicious-feed-refresh', 'trust-anchor-refresh']) {
      expect(workers.find((worker) => worker.name === name)?.options.concurrency).toBe(1);
    }
    await running.close();
  });

  it('schedules the network refresh every 15 minutes only when told to (C92.2, Workflow 7A)', async () => {
    const scheduled = async (refresh: boolean) => {
      const { options, repeatableQueues } = harness({
        network: { ...NO_NETWORK_SETTINGS, refresh },
      });
      const running = startWorkers(options);
      await Promise.resolve();
      await running.close();
      return repeatableQueues.flatMap((queue) =>
        queue.schedules.filter((schedule) => schedule.id === 'network-refresh'),
      );
    };

    expect(await scheduled(false)).toEqual([]);
    expect(await scheduled(true)).toEqual([
      {
        id: 'network-refresh',
        repeat: { every: 900_000 },
        template: { name: 'network-refresh' },
      },
    ]);
  });

  it('schedules the repair sweep of submitted verifications with the verification queue (Workflow 5C review K1)', async () => {
    const { options, workers, repeatableQueues } = harness({
      verificationQueue: createRecordingVerificationQueue(),
    });
    const running = startWorkers(options);
    await Promise.resolve();

    expect(repeatableQueues.map((queue) => [queue.name, queue.schedules])).toEqual([
      [
        'inquiry-expiry',
        [{ id: 'inquiry-expiry', repeat: { every: 60_000 }, template: { name: 'inquiry-expiry' } }],
      ],
      [
        'submitted-verification-sweep',
        [
          {
            id: 'submitted-verification-sweep',
            repeat: { every: 60_000 },
            template: { name: 'submitted-verification-sweep' },
          },
        ],
      ],
    ]);
    expect(
      workers.find((worker) => worker.name === 'submitted-verification-sweep')?.options.concurrency,
    ).toBe(1);
    await running.close();
  });

  it('schedules neither with an empty feed list and the trust refresh off', async () => {
    const { options, repeatableQueues } = harness({
      maliciousFeeds: { schema_version: 1, feeds: [] },
      nfc: { allowIcaoCrls: true, trustAnchorRefresh: false },
    });
    const running = startWorkers(options);

    expect(repeatableQueues.map((queue) => queue.name)).toEqual(['inquiry-expiry']);
    await running.close();
  });
});

describe('startWorkers: the NFC self-test (C62.9)', () => {
  it('runs the platform self-test once at start with the worker logger, before any job', async () => {
    const { options, logger } = harness();
    vi.mocked(nfcSelfTest).mockClear();
    const running = startWorkers(options);

    expect(vi.mocked(nfcSelfTest).mock.calls).toEqual([[logger]]);
    await running.close();
  });
});

describe('startWorkers: shutdown (F015)', () => {
  it('keeps closing when a worker or queue fails to close, and logs each failure', async () => {
    const { options, workers, queue, logger, repeatableQueues } = harness();
    const running = startWorkers(options);
    const [first, second] = workers;
    if (first === undefined || second === undefined) {
      throw new Error('expected the workers to start');
    }
    first.close = () => {
      first.closed = true;
      return Promise.reject(new Error('connection reset'));
    };
    const [expiryQueue] = repeatableQueues;
    if (expiryQueue !== undefined) {
      expiryQueue.close = () => Promise.reject(new TypeError('already closed'));
    }

    await expect(running.close()).resolves.toBeUndefined();

    expect(workers.every((worker) => worker.closed)).toBe(true);
    expect(queue.closed).toBe(true);
    expect(logger.entries).toEqual(
      expect.arrayContaining([
        {
          level: 'error',
          object: { queue: 'process-verification', error: 'Error' },
          message: 'worker did not close',
        },
        {
          level: 'error',
          object: { queue: 'inquiry-expiry', error: 'TypeError' },
          message: 'queue did not close',
        },
      ]),
    );
  });
});

// Phase 6 (C74, C85.4): the report workers ----------------------------------------------------

const REPORT_LIMITS: ReportLimits = {
  perMinute: 600,
  maxRecurringPerEnvironment: 250_000,
  maxMediaRunsPerDay: 8_640,
};
const WATCHLIST_SETTINGS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: false,
  removedRetentionDays: 90,
  euFsfToken: null,
  wikidataUserAgent: null,
  wikidataSparqlUrl: 'https://query.wikidata.org/sparql',
  pep: {
    openTenureMaxYears: 20,
    includeRelatives: false,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
};

function reportOptions(overrides: Partial<WorkerReportOptions> = {}): WorkerReportOptions {
  return {
    watchlists: WATCHLIST_SETTINGS,
    limits: REPORT_LIMITS,
    runs: createRecordingReportRunQueue(),
    rescreens: createRecordingReportRescreenQueue(),
    ...overrides,
  };
}

const reportRun = (): ReportRunJob => ({
  environmentId,
  reportId: newId('rep'),
  runId: newId('rpr'),
});

describe('reportRunProcessor (C74.1)', () => {
  const runDeps = (overrides: Partial<ReportRunWorkerDeps> = {}): ReportRunWorkerDeps => ({
    db,
    clock: { now: () => new Date() },
    logger: createCapturingLogger(),
    watchlists: WATCHLIST_SETTINGS,
    limits: REPORT_LIMITS,
    keyring: database.keyring,
    events: createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
    }),
    ...overrides,
  });

  it('hands the framework the job, its deps and whether this is the last attempt', async () => {
    const process = vi.fn(() => Promise.resolve({ outcome: 'not_claimed' as const }));
    const deps = runDeps({ process });
    const processor = reportRunProcessor(deps);
    const data = reportRun();

    await expect(
      processor({ id: data.runId, data, attemptsMade: 0, opts: { attempts: 5 } }),
    ).resolves.toEqual({ outcome: 'not_claimed' });
    await processor({ id: data.runId, data, attemptsMade: 4, opts: { attempts: 5 } });

    expect(process.mock.calls).toEqual([
      [data, deps, { lastAttempt: false }],
      [data, deps, { lastAttempt: true }],
    ]);
  });

  it('turns a permanent failure into an unrecoverable one, described, and rethrows the rest', async () => {
    const data = reportRun();
    const permanent = reportRunProcessor(
      runDeps({ process: () => Promise.reject(new PermanentJobError('report_missing')) }),
    );
    const transient = reportRunProcessor(
      runDeps({ process: () => Promise.reject(new TypeError('synthetic outage')) }),
    );

    const failure = await permanent({ id: data.runId, data }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnrecoverableError);
    expect((failure as Error).message).toBe('The job cannot succeed (report_missing)');
    await expect(transient({ id: data.runId, data })).rejects.toThrow(TypeError);
  });

  it('runs the framework by default, which claims no run that does not exist', async () => {
    const data = reportRun();

    await expect(reportRunProcessor(runDeps())({ id: data.runId, data })).resolves.toEqual({
      outcome: 'not_claimed',
    });
  });
});

describe('reportRescreenProcessor (C74.4)', () => {
  const rescreenDeps = () => ({
    db,
    clock: { now: () => new Date() },
    logger: createCapturingLogger(),
    watchlists: WATCHLIST_SETTINGS,
  });

  it('hands the re-screen the sync and its deps, and fails a permanent error for good', async () => {
    const process = vi.fn(() =>
      Promise.resolve({ environments: 2, subjects: 10, runsInserted: 1 }),
    );
    const deps = { ...rescreenDeps(), process };

    await expect(
      reportRescreenProcessor(deps)({ id: 'rescreen-7', data: { syncId: 7 } }),
    ).resolves.toEqual({ environments: 2, subjects: 10, runsInserted: 1 });
    expect(process.mock.calls).toEqual([[{ syncId: 7 }, deps]]);

    const permanent = reportRescreenProcessor({
      ...rescreenDeps(),
      process: () => Promise.reject(new PermanentJobError('sync_missing')),
    });
    await expect(permanent({ id: 'rescreen-8', data: { syncId: 8 } })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('runs the re-screen by default', async () => {
    await expect(
      reportRescreenProcessor(rescreenDeps())({ id: 'rescreen-9', data: { syncId: 9 } }),
    ).resolves.toMatchObject({ runsInserted: 0 });
  });
});

describe('startWorkers: the report workers and jobs (C74, C85.4)', () => {
  it('starts the report-run and report-rescreen workers only when it runs reports', async () => {
    const { options, workers } = harness({ reports: reportOptions() });
    const running = startWorkers(options);

    expect(workers.map((worker) => worker.name)).toEqual([
      'process-verification',
      'webhook-delivery',
      'report-run',
      'report-rescreen',
      'inquiry-expiry',
      'report-sweep',
    ]);
    const concurrency = (name: string) =>
      workers.find((worker) => worker.name === name)?.options.concurrency;
    // One re-screen at a time per process: each holds up to 50,000 decrypted subjects (C74.4).
    expect([concurrency('report-run'), concurrency('report-rescreen')]).toEqual([3, 1]);
    await running.close();
  });

  it('wires the run framework and the re-screen with the worker’s deps', async () => {
    const cache = createInMemoryKeyValueCache();
    const outboundHttp = createRefusingOutboundHttp();
    const dnsResolver = createFakeDnsResolver();
    const rateLimiter = createAllowAllRateLimiter();
    const providers = createProviderBindings(NO_PROVIDERS);
    const blindIndexKey = new Uint8Array(32).fill(7);
    const processRun = vi.fn(() => Promise.resolve({ outcome: 'not_claimed' as const }));
    const processRescreen = vi.fn(() =>
      Promise.resolve({ environments: 0, subjects: 0, runsInserted: 0 }),
    );
    const reports = reportOptions({ processRun, processRescreen });
    const { options, workers, logger } = harness({
      cache,
      outboundHttp,
      dnsResolver,
      rateLimiter,
      providers,
      blindIndexKey,
      reports,
    });
    const running = startWorkers(options);
    const data = reportRun();

    await workers
      .find((worker) => worker.name === 'report-run')
      ?.processor({ id: data.runId, data, attemptsMade: 0, opts: { attempts: 5 } });
    await workers
      .find((worker) => worker.name === 'report-rescreen')
      ?.processor({ id: 'rescreen-3', data: { syncId: 3 } });

    expect(processRun).toHaveBeenCalledWith(
      data,
      expect.objectContaining({
        db,
        logger,
        keyring: database.keyring,
        providers,
        cache,
        outboundHttp,
        dnsResolver,
        rateLimiter,
        blindIndexKey,
        watchlists: WATCHLIST_SETTINGS,
        limits: REPORT_LIMITS,
        reportRuns: reports.runs,
      }),
      { lastAttempt: false },
    );
    expect(processRescreen).toHaveBeenCalledWith(
      { syncId: 3 },
      expect.objectContaining({ db, logger, watchlists: WATCHLIST_SETTINGS }),
    );
    await running.close();
  });

  it('gives the report runs the worker’s network snapshots, for the ip-address report (C92.3, C106.1)', async () => {
    const networkSnapshots = createInMemoryNetworkSnapshots();
    const processRun = vi.fn(() => Promise.resolve({ outcome: 'not_claimed' as const }));
    const { options, workers } = harness({
      networkSnapshots,
      reports: reportOptions({ processRun }),
    });
    const running = startWorkers(options);
    const data = reportRun();

    await workers
      .find((worker) => worker.name === 'report-run')
      ?.processor({ id: data.runId, data, attemptsMade: 0, opts: { attempts: 5 } });

    expect(processRun).toHaveBeenCalledWith(data, expect.objectContaining({ networkSnapshots }), {
      lastAttempt: false,
    });
    await running.close();
  });

  it('gives the re-screen the blind-index key, so stale evidence is found by entry_index (owner decision 3 after 6B)', async () => {
    const blindIndexKey = new Uint8Array(32).fill(5);
    const processRescreen = vi.fn(() =>
      Promise.resolve({ environments: 0, subjects: 0, runsInserted: 0 }),
    );
    const { options, workers } = harness({
      blindIndexKey,
      reports: reportOptions({ processRescreen }),
    });
    const running = startWorkers(options);

    await workers
      .find((worker) => worker.name === 'report-rescreen')
      ?.processor({ id: 'rescreen-4', data: { syncId: 4 } });

    expect(processRescreen).toHaveBeenCalledWith(
      { syncId: 4 },
      expect.objectContaining({ blindIndexKey }),
    );
    await running.close();
  });

  it('schedules the report sweep after the Phase 5 jobs, and the list refresh when turned on', async () => {
    const { options, repeatableQueues } = harness({
      verificationQueue: createRecordingVerificationQueue(),
      reports: reportOptions({ watchlists: { ...WATCHLIST_SETTINGS, refresh: true } }),
    });
    const running = startWorkers(options);
    await Promise.resolve();

    expect(repeatableQueues.map((queue) => [queue.name, queue.schedules[0]?.repeat])).toEqual([
      ['inquiry-expiry', { every: 60_000 }],
      ['submitted-verification-sweep', { every: 60_000 }],
      ['report-sweep', { every: 15_000 }],
      ['watchlists-refresh', { every: 900_000 }],
    ]);
    await running.close();
  });
});

describe('main', () => {
  it('refuses an invalid configuration before connecting to anything', async () => {
    await expect(main({ NODE_ENV: 'test' })).rejects.toBeInstanceOf(ConfigError);
  });

  it('refuses to start with a sandbox provider bound to production (C35, ADR 0002 §3d)', async () => {
    const error = await main(
      syntheticEnv({ OPENVERIFY_PROVIDER_PUBLIC_FIGURE_PRODUCTION: 'sandbox' }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues).toEqual([
      'OPENVERIFY_PROVIDER_PUBLIC_FIGURE_PRODUCTION: a sandbox provider cannot be bound to production environments',
    ]);
  });

  it('refuses to bind gdelt-doc without the disclosure acknowledgement, naming the variable (C81.1)', async () => {
    const error = await main(
      syntheticEnv({ OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: 'gdelt-doc' }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues).toEqual([
      'OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: must be true to bind adverseMedia to gdelt-doc, which sends every screened name to GDELT (decision 7)',
    ]);
  });

  it('refuses private webhook networks in production mode', async () => {
    // Low-entropy synthetic values: valid for the config parser, obviously not secrets.
    const filler = (length: number) => 'x'.repeat(length);
    const env = {
      OPENVERIFY_MODE: 'production',
      OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true',
      DATABASE_URL: 'postgres://127.0.0.1:1/openverify',
      REDIS_URL: 'redis://127.0.0.1:1',
      S3_BUCKET: 'openverify-files',
      S3_ACCESS_KEY_ID: filler(20),
      S3_SECRET_ACCESS_KEY: filler(40),
      OPENVERIFY_KEK: Buffer.alloc(32, 7).toString('base64'),
      OPENVERIFY_API_KEY_PEPPER: filler(40),
      OPENVERIFY_BLIND_INDEX_KEY: Buffer.alloc(32, 8).toString('base64'),
      OPENVERIFY_FLOW_PUBLIC_URL: 'https://flow.example.test',
      OPENVERIFY_VISION_URL: 'http://127.0.0.1:1',
      OPENVERIFY_VISION_SERVICE_TOKEN: filler(40),
    };
    await expect(main(env)).rejects.toBeInstanceOf(WebhookNetworkConfigError);
  });
});
