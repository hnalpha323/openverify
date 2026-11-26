/**
 * Workflow 9B Stage 1b, checkpoint (A): the analytics jobs in the worker (C163.2, C163.4, C174.3):
 * - the `analytics-rebuild` worker and the `analytics-rollup` pass every 5 minutes, both only with
 *   the analytics producer, the pass handed the rebuild producer;
 * - the processor turns a permanent failure into BullMQ's `UnrecoverableError`; the pass and the
 *   rebuild are the built ones (`api-analytics`), no longer the stubs that failed permanently;
 * - the producer adds an environment's rebuild, removed when it ends, and refuses a malformed one.
 */
import { createKeyring, type Db } from '@openverify/db';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_REBUILD_JOB,
  ANALYTICS_REBUILD_JOB_OPTIONS,
  ANALYTICS_REBUILD_QUEUE,
  ANALYTICS_ROLLUP_INTERVAL_MS,
  ANALYTICS_ROLLUP_QUEUE,
  createAnalyticsRebuildQueue,
} from './jobs/analytics-queues.js';
import { processAnalyticsRebuild, type ProcessAnalyticsRebuild } from './jobs/analytics/rebuild.js';
import { runAnalyticsRollup } from './jobs/analytics/rollup.js';
import { PermanentJobError } from './jobs/errors.js';
import { analyticsRepeatableJobs } from './jobs/repeatable/index.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { AnalyticsRebuildJob, AnalyticsRebuildQueue, VisionClient } from './ports.js';
import { fixedClock } from './test-support/fakes.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import {
  analyticsRebuildProcessor,
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

const job: AnalyticsRebuildJob = { environmentId: 'env_01M5CJXHG0000000000000000A' };

const recordingRebuilds = (): AnalyticsRebuildQueue & { jobs: AnalyticsRebuildJob[] } => {
  const jobs: AnalyticsRebuildJob[] = [];
  return {
    jobs,
    enqueueAnalyticsRebuild: (queued) => {
      jobs.push(queued);
      return Promise.resolve();
    },
  };
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

describe('startWorkers: the analytics-rebuild worker and the analytics-rollup (C163.2, C163.4)', () => {
  it('starts both only with the analytics producer', async () => {
    const without = harness();
    await startWorkers(without.options).close();
    expect(without.workers.map((worker) => worker.name)).not.toContain(ANALYTICS_REBUILD_QUEUE);
    expect(without.repeatables).not.toContain(ANALYTICS_ROLLUP_QUEUE);

    const withAnalytics = harness({ analytics: { rebuilds: recordingRebuilds() } });
    const running = startWorkers(withAnalytics.options);
    expect(withAnalytics.workers.map((worker) => worker.name)).toEqual(
      expect.arrayContaining([ANALYTICS_REBUILD_QUEUE, ANALYTICS_ROLLUP_QUEUE]),
    );
    expect(withAnalytics.repeatables).toContain(ANALYTICS_ROLLUP_QUEUE);
    await running.close();
  });

  it('hands each rebuild to its processor with the worker’s database, clock and logger', async () => {
    const process = vi.fn<ProcessAnalyticsRebuild>(() => Promise.resolve({ days: 4 }));
    const { options, workers } = harness({
      analytics: { rebuilds: recordingRebuilds(), processRebuild: process },
    });
    const running = startWorkers(options);
    const result = await workers
      .find((worker) => worker.name === ANALYTICS_REBUILD_QUEUE)
      ?.processor({ id: '1', data: job });
    expect(result).toEqual({ days: 4 });
    const [data, deps] = process.mock.calls[0] ?? [];
    expect(data).toEqual(job);
    expect(deps).toMatchObject({ db: options.db, clock: options.clock, logger: options.logger });
    await running.close();
  });
});

describe('analyticsRebuildProcessor and its stub (C163.2)', () => {
  const deps = { db: {} as Db, clock: fixedClock(), logger: createCapturingLogger() };

  it('turns a permanent failure into UnrecoverableError', async () => {
    const processor = analyticsRebuildProcessor({
      ...deps,
      process: () => Promise.reject(new PermanentJobError('synthetic_permanent')),
    });
    const processed = await processor({ id: 'x', data: job }).catch((thrown: unknown) => thrown);
    expect(processed).toBeInstanceOf(UnrecoverableError);
  });

  it('runs the built rebuild by default, no longer the stub', async () => {
    // An environment the database does not hold rebuilds nothing (C163.2).
    const empty = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    await expect(processAnalyticsRebuild(job, { ...deps, db: empty })).resolves.toEqual({
      days: 0,
    });
  });

  it('lets a passing failure be retried', async () => {
    const processor = analyticsRebuildProcessor({
      ...deps,
      process: () => Promise.reject(new Error('connection reset')),
    });
    const error = await processor({ id: 'x', data: job }).catch((thrown: unknown) => thrown);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });
});

describe('the analytics-rollup (C163.4)', () => {
  const deps = { db: {} as Db, clock: fixedClock(), logger: createCapturingLogger() };

  it('runs every 5 minutes, and only with analytics', () => {
    expect(analyticsRepeatableJobs(deps, undefined)).toEqual([]);
    const [rollup, ...rest] = analyticsRepeatableJobs(deps, { rebuilds: recordingRebuilds() });
    expect(rest).toEqual([]);
    expect(rollup?.name).toBe(ANALYTICS_ROLLUP_QUEUE);
    expect(rollup?.repeat).toEqual({ every: ANALYTICS_ROLLUP_INTERVAL_MS });
    expect(ANALYTICS_ROLLUP_INTERVAL_MS).toBe(300_000);
  });

  it('hands each pass the rebuild producer', async () => {
    const rebuilds = recordingRebuilds();
    const seen: unknown[] = [];
    const [rollup] = analyticsRepeatableJobs(deps, { rebuilds }, (passDeps) => {
      seen.push(passDeps);
      return Promise.resolve({ environments: 0, days: 0, rebuildsQueued: 0, failed: 0 });
    });
    await rollup?.run();
    expect(seen).toEqual([expect.objectContaining({ db: deps.db, clock: deps.clock, rebuilds })]);
  });

  it('is the built pass: over no environment it does nothing and says nothing is unbuilt', async () => {
    const logger = createCapturingLogger();
    const none = {
      select: () => ({ from: () => ({ orderBy: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    await expect(runAnalyticsRollup({ ...deps, db: none, logger })).resolves.toEqual({
      environments: 0,
      days: 0,
      rebuildsQueued: 0,
      failed: 0,
    });
    expect(logger.entries.map((entry) => entry.message)).not.toContain(
      'analytics rollup not built yet',
    );
  });
});

describe('the analytics-rebuild producer (C163.2)', () => {
  it('adds an environment’s rebuild, removed when it ends', async () => {
    const queue = createRecordingQueue<AnalyticsRebuildJob>();
    await createAnalyticsRebuildQueue({ queue }).enqueueAnalyticsRebuild(job);
    expect(queue.jobs).toEqual([
      { name: ANALYTICS_REBUILD_JOB, data: job, options: ANALYTICS_REBUILD_JOB_OPTIONS },
    ]);
    expect(ANALYTICS_REBUILD_JOB_OPTIONS).toMatchObject({
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('refuses a job without an environment id', async () => {
    const queue = createRecordingQueue<AnalyticsRebuildJob>();
    await expect(
      createAnalyticsRebuildQueue({ queue }).enqueueAnalyticsRebuild({ environmentId: 'org_1' }),
    ).rejects.toThrow(TypeError);
    expect(queue.jobs).toEqual([]);
  });
});
