/**
 * Workflow 10B Stage 1b (I) (C211.4; `foundation-10b`): the `integrity-decode` job in the worker and
 * its producer:
 * - the worker runs `integrity-decode` only with the integrity options, handing each job the database,
 *   the keyring, the bound providers and the outbound client (the decode runs in the job, never in a
 *   request);
 * - the processor turns a permanent failure into BullMQ's `UnrecoverableError` and lets any other be
 *   retried (the job itself, `jobs/integrity/decode.ts`, is tested beside it by `api-integrity`);
 * - the producer keys one job per challenge, carries ids only (never a token) and refuses a malformed
 *   one.
 */
import { createKeyring, type Db } from '@openverify/db';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createOutboundHttp } from './http/index.js';
import { PermanentJobError } from './jobs/errors.js';
import { type ProcessIntegrityDecode } from './jobs/integrity/decode.js';
import {
  createIntegrityDecodeQueue,
  INTEGRITY_DECODE_JOB,
  INTEGRITY_DECODE_JOB_OPTIONS,
  INTEGRITY_DECODE_QUEUE,
} from './jobs/integrity-queues.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { IntegrityDecodeJob, ProviderBindings, VisionClient } from './ports.js';
import { fixedClock } from './test-support/fakes.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import {
  integrityDecodeProcessor,
  startWorkers,
  type FakeableWorker,
  type RepeatableQueue,
  type StartWorkersOptions,
  type WorkerProcessor,
} from './worker.js';

const unused = () => Promise.reject(new Error('unused'));
const vision: VisionClient = {
  analyzeGovernmentId: unused,
  analyzeSelfie: unused,
  embedFace: unused,
  compareBackground: unused,
  analyzeDocument: unused,
  renderDocumentPage: unused,
  convertPortrait: unused,
  maskBackground: unused,
  createRendition: unused,
};
const sender: WebhookSender = { send: unused, close: () => Promise.resolve() };

interface FakeWorker extends FakeableWorker {
  name: string;
  processor: WorkerProcessor;
  options: WorkerOptions;
}

const job: IntegrityDecodeJob = {
  environmentId: 'env_01M5CJXHG0000000000000000A',
  challengeId: 'ich_01M5CK16P0D13FXHZSS4TCFBVH',
};

function harness(overrides: Partial<StartWorkersOptions> = {}) {
  const workers: FakeWorker[] = [];
  const options: StartWorkersOptions = {
    connection: { url: 'redis://127.0.0.1:1' },
    prefix: 'test',
    db: {} as Db,
    storage: createMemoryStorage(),
    keyring: createKeyring(randomBytes(32)),
    vision,
    sender,
    logger: createCapturingLogger(),
    concurrency: 3,
    sweepIntervalMs: 0,
    clock: fixedClock(),
    createQueue: () => createRecordingQueue<WebhookDeliveryJob>(),
    createRepeatableQueue: (): RepeatableQueue => ({
      upsertJobScheduler: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
    createWorker: (name, processor, workerOptions) => {
      const worker: FakeWorker = {
        name,
        processor: processor as WorkerProcessor,
        options: workerOptions,
        on: () => worker,
        close: () => Promise.resolve(),
      };
      workers.push(worker);
      return worker;
    },
    ...overrides,
  };
  return { options, workers };
}

describe('startWorkers: the integrity-decode worker (C211.4)', () => {
  it('starts only with the integrity options', async () => {
    const without = harness();
    await startWorkers(without.options).close();
    expect(without.workers.map((worker) => worker.name)).not.toContain(INTEGRITY_DECODE_QUEUE);

    const withIntegrity = harness({ integrity: {} });
    const running = startWorkers(withIntegrity.options);
    expect(withIntegrity.workers.map((worker) => worker.name)).toContain(INTEGRITY_DECODE_QUEUE);
    await running.close();
  });

  it('hands each job the database, the keyring, the bound providers and the outbound client', async () => {
    const process = vi.fn<ProcessIntegrityDecode>(() =>
      Promise.resolve({ outcome: 'decoded' as const }),
    );
    const providers = { sandbox: {}, production: {} } as ProviderBindings;
    const outboundHttp = createOutboundHttp();
    const { options, workers } = harness({ integrity: { process }, providers, outboundHttp });
    const running = startWorkers(options);

    const result = await workers
      .find((worker) => worker.name === INTEGRITY_DECODE_QUEUE)
      ?.processor({ id: job.challengeId, data: job });

    expect(result).toEqual({ outcome: 'decoded' });
    const [data, deps] = process.mock.calls[0] ?? [];
    expect(data).toEqual(job);
    expect(deps).toMatchObject({
      db: options.db,
      keyring: options.keyring,
      providers,
      outboundHttp,
      logger: options.logger,
      clock: options.clock,
    });
    await running.close();
  });
});

describe('integrityDecodeProcessor (C211.4)', () => {
  const deps = {
    db: {} as Db,
    clock: fixedClock(),
    logger: createCapturingLogger(),
    keyring: createKeyring(randomBytes(32)),
  };

  it('turns a permanent failure into an unrecoverable one', async () => {
    const processed = await integrityDecodeProcessor({
      ...deps,
      process: () => Promise.reject(new PermanentJobError('synthetic_permanent')),
    })({ id: 'x', data: job }).catch((thrown: unknown) => thrown);
    expect(processed).toBeInstanceOf(UnrecoverableError);
  });

  it('lets a passing failure be retried', async () => {
    const processor = integrityDecodeProcessor({
      ...deps,
      process: () => Promise.reject(new Error('connection reset')),
    });
    const error = await processor({ id: 'x', data: job }).catch((thrown: unknown) => thrown);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });
});

describe('the integrity-decode producer (C211.4)', () => {
  it('adds one job per challenge, its id the challenge id, carrying ids only', async () => {
    const queue = createRecordingQueue<IntegrityDecodeJob>();
    const producer = createIntegrityDecodeQueue({ queue });

    await producer.enqueueIntegrityDecode({ ...job, token: 'synthetic' } as IntegrityDecodeJob);

    expect(queue.jobs).toEqual([
      {
        name: INTEGRITY_DECODE_JOB,
        data: job,
        options: { ...INTEGRITY_DECODE_JOB_OPTIONS, jobId: job.challengeId },
      },
    ]);
    expect(INTEGRITY_DECODE_JOB_OPTIONS).toMatchObject({
      attempts: 5,
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('refuses a job without an env_ and an ich_ id', async () => {
    const producer = createIntegrityDecodeQueue({ queue: createRecordingQueue() });

    await expect(
      producer.enqueueIntegrityDecode({ ...job, challengeId: 'chc_01M5CK16P0D13FXHZSS4TCFBVH' }),
    ).rejects.toThrow(TypeError);
    await expect(
      producer.enqueueIntegrityDecode({ ...job, environmentId: 'inq_01M5CK16P0D13FXHZSS4TCFBVH' }),
    ).rejects.toThrow(TypeError);
  });
});
