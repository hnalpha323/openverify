/**
 * C90.5, C107.1, C107.2 (Workflow 7A Stage 1b (S)): with the signals producer, the worker starts
 * the `inquiry-signals` worker, whose processor hands each job to `processInquirySignals`
 * (`api-signals`) with the worker's deps, and schedules the `inquiry-signals-sweep` every 15 s.
 * Without it, neither exists. The database is never reached here: the workers are fakes.
 */
import { createKeyring, type Db } from '@openverify/db';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PermanentJobError } from './jobs/process-verification.js';
import type { InquirySignalsDeps, ProcessInquirySignals } from './jobs/signals/process.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { InquirySignalsJob, VisionClient } from './ports.js';
import {
  createInMemoryNetworkSnapshots,
  createRecordingInquirySignalsQueue,
  fixedClock,
} from './test-support/fakes.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import {
  inquirySignalsProcessor,
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

const job: InquirySignalsJob = {
  environmentId: 'env_01M5CJXHG0000000000000000A',
  inquiryId: 'inq_01M5CK16P0D13FXHZSS4TCFBVH',
};

function harness(overrides: Partial<StartWorkersOptions> = {}) {
  const workers: FakeWorker[] = [];
  const repeatables: string[] = [];
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
    createRepeatableQueue: (name): RepeatableQueue => {
      repeatables.push(name);
      return { upsertJobScheduler: () => Promise.resolve(), close: () => Promise.resolve() };
    },
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
  return { options, workers, repeatables };
}

describe('startWorkers: the inquiry-signals worker and sweep (C90.5, C107.1, C107.2)', () => {
  it('starts both only with the signals producer', async () => {
    const without = harness();
    await startWorkers(without.options).close();
    expect(without.workers.map((worker) => worker.name)).not.toContain('inquiry-signals');
    expect(without.repeatables).not.toContain('inquiry-signals-sweep');

    const queue = createRecordingInquirySignalsQueue();
    const withSignals = harness({ signals: { queue } });
    const running = startWorkers(withSignals.options);

    expect(withSignals.workers.map((worker) => worker.name)).toEqual(
      expect.arrayContaining(['inquiry-signals', 'inquiry-signals-sweep']),
    );
    expect(withSignals.repeatables).toContain('inquiry-signals-sweep');
    await running.close();
  });

  it('hands each job to the computation with the worker’s keys, snapshots and events', async () => {
    const process = vi.fn<ProcessInquirySignals>(() =>
      Promise.resolve({ outcome: 'computed' as const, signals: 13, markedForReview: false }),
    );
    const networkSnapshots = createInMemoryNetworkSnapshots();
    const blindIndexKey = new Uint8Array(32).fill(7);
    const { options, workers } = harness({
      signals: { queue: createRecordingInquirySignalsQueue(), process },
      networkSnapshots,
      blindIndexKey,
    });
    const running = startWorkers(options);

    const result = await workers
      .find((worker) => worker.name === 'inquiry-signals')
      ?.processor({ id: job.inquiryId, data: job });

    expect(result).toEqual({ outcome: 'computed', signals: 13, markedForReview: false });
    expect(process).toHaveBeenCalledTimes(1);
    const [data, deps] = process.mock.calls[0] ?? [];
    expect(data).toEqual(job);
    expect(deps).toMatchObject({
      db: options.db,
      keyring: options.keyring,
      blindIndexKey,
      networkSnapshots,
      logger: options.logger,
      clock: options.clock,
    });
    expect(typeof deps?.events.stage).toBe('function');
    await running.close();
  });
});

describe('inquirySignalsProcessor (C90.5)', () => {
  const deps = (): InquirySignalsDeps => ({
    db: {} as Db,
    clock: fixedClock(),
    logger: createCapturingLogger(),
    events: {
      stage: () => Promise.reject(new Error('unused')),
      dispatch: () => Promise.resolve(),
    } as unknown as InquirySignalsDeps['events'],
    keyring: createKeyring(randomBytes(32)),
  });

  it('turns a permanent failure into an unrecoverable one, and rethrows others', async () => {
    const permanent = inquirySignalsProcessor({
      ...deps(),
      process: () => Promise.reject(new PermanentJobError('inquiry_missing')),
    });
    await expect(permanent({ id: job.inquiryId, data: job })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    const transient = inquirySignalsProcessor({
      ...deps(),
      process: () => Promise.reject(new RangeError('synthetic outage')),
    });
    await expect(transient({ id: job.inquiryId, data: job })).rejects.toBeInstanceOf(RangeError);
  });
});
