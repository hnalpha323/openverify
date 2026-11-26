/**
 * Workflow 11A Stage 1b (C) (`foundation-11a`): the `connect-token-expiry` minute sweep (C232.5),
 * scheduled only while the worker runs with Connect on (`OPENVERIFY_CONNECT_ENABLED`), whose pass is
 * `runConnectTokenExpiry` (`jobs/connect-token-expiry.ts`, `api-connect`'s): until it is built the
 * pass fails loudly (501 `notBuilt`), so no token reads as expired by a sweep that did not run.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createKeyring, type Db } from '@openverify/db';
import { runConnectTokenExpiry } from './jobs/connect-token-expiry.js';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { VisionClient } from './ports.js';
import { fixedClock } from './test-support/fakes.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import {
  startWorkers,
  type FakeableWorker,
  type RepeatableQueue,
  type StartWorkersOptions,
  type WorkerProcessor,
} from './worker.js';

const unused = () => Promise.reject(new Error('unused'));
const vision = new Proxy({}, { get: () => unused }) as VisionClient;
const sender: WebhookSender = { send: unused, close: () => Promise.resolve() };

interface FakeWorker extends FakeableWorker {
  name: string;
  processor: WorkerProcessor;
}

function harness(overrides: Partial<StartWorkersOptions> = {}) {
  const workers: FakeWorker[] = [];
  const schedules = new Map<string, unknown>();
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
      upsertJobScheduler: (name, repeat) => {
        schedules.set(name, repeat);
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    }),
    createWorker: (name, processor) => {
      const worker: FakeWorker = {
        name,
        processor: processor as WorkerProcessor,
        on: () => worker,
        close: () => Promise.resolve(),
      };
      workers.push(worker);
      return worker;
    },
    ...overrides,
  };
  return { options, workers, schedules };
}

describe('startWorkers: connect-token-expiry (C232.5)', () => {
  it('is scheduled every 60 seconds, and only with Connect on', async () => {
    const off = harness();
    await startWorkers(off.options).close();
    expect([...off.schedules.keys()]).not.toContain('connect-token-expiry');

    const on = harness({ connect: {} });
    const running = startWorkers(on.options);
    expect(on.schedules.get('connect-token-expiry')).toEqual({ every: 60_000 });
    await running.close();
  });

  // Workflow 11A api-connect checkpoint 2 built the pass (`share-tokens.test.ts` holds what it does).
  it('runs the pass it is given each tick, the built connect-token-expiry by default', async () => {
    const passes: unknown[] = [];
    const on = harness({
      connect: {
        runTokenExpiry: (deps) => {
          passes.push(deps);
          return Promise.resolve({ expired: 0 });
        },
      },
    });
    const running = startWorkers(on.options);
    const sweep = on.workers.find((worker) => worker.name === 'connect-token-expiry');
    await sweep?.processor({} as never);
    expect(passes).toHaveLength(1);
    expect(typeof runConnectTokenExpiry).toBe('function');
    await running.close();
  });
});

describe('the connect-redeem queue (C234.2; Workflow 11A Stage 1b (R))', () => {
  it('starts its worker only with Connect on, whose job fails loudly until api-redeem builds it', async () => {
    const off = harness();
    await startWorkers(off.options).close();
    expect(off.workers.map((worker) => worker.name)).not.toContain('connect-redeem');

    const on = harness({ connect: {} });
    const running = startWorkers(on.options);
    const redeem = on.workers.find((worker) => worker.name === 'connect-redeem');
    expect(redeem).toBeDefined();
    await expect(
      redeem?.processor({
        data: {
          environmentId: 'env_01M5CN0000000000000011A600',
          shareTokenId: 'cnst_01M5CN0000000000000011A200',
        },
      }),
    ).rejects.toThrow();
    await running.close();
  });

  it('hands the redemption the worker’s event publisher and the workflow services as its write paths (integration-11a)', async () => {
    const seen: unknown[] = [];
    const services = { marker: 'synthetic-workflow-services' };
    const on = harness({
      connect: {
        processRedeem: (_job, deps) => {
          seen.push(deps);
          return Promise.resolve({ outcome: 'skipped' as const });
        },
      },
      workflows: {
        createServices: () => services as never,
        steps: createRecordingQueue() as never,
        triggers: createRecordingQueue() as never,
        waitMatches: createRecordingQueue() as never,
      },
    });
    const running = startWorkers(on.options);
    const redeem = on.workers.find((worker) => worker.name === 'connect-redeem');
    await redeem?.processor({
      data: {
        environmentId: 'env_01M5CN0000000000000011A600',
        shareTokenId: 'cnst_01M5CN0000000000000011A200',
      },
    });
    expect(seen).toHaveLength(1);
    const deps = seen[0] as { events?: { dispatch?: unknown }; api?: unknown };
    expect(typeof deps.events?.dispatch).toBe('function');
    expect(deps.api).toBe(services);
    await running.close();
  });

  it('main() gives the workflow services the connect-redeem producer while Connect is on, and closes it (integration-11a)', () => {
    const source = readFileSync(fileURLToPath(new URL('./worker.ts', import.meta.url)), 'utf8');
    const main = source.slice(source.indexOf('export async function main('));
    expect(main).toMatch(
      /const connectRedeems = config\.connect\.enabled\s*\?\s*createConnectRedeemQueue\(/,
    );
    const services = main.slice(main.indexOf('createWorkflowServices(config, {'));
    expect(services.slice(0, services.indexOf('}),'))).toContain('connectRedeems');
    expect(main).toMatch(/connectRedeems\?\.close\(\)/);
  });

  it('enqueues ids only, one job per token', async () => {
    const queues = (await import('./jobs/connect-queues.js')) as Record<string, unknown>;
    const create = queues.createConnectRedeemQueue as (options: {
      queue: ReturnType<typeof createRecordingQueue>;
    }) => { enqueueConnectRedeem(job: Record<string, string>): Promise<void> };
    expect(typeof create).toBe('function');
    const recording = createRecordingQueue();
    const producer = create({ queue: recording });
    await producer.enqueueConnectRedeem({
      environmentId: 'env_01M5CN0000000000000011A600',
      shareTokenId: 'cnst_01M5CN0000000000000011A200',
    });
    expect(recording.jobs).toHaveLength(1);
    expect(recording.jobs[0]).toMatchObject({
      name: 'connect-redeem',
      data: {
        environmentId: 'env_01M5CN0000000000000011A600',
        shareTokenId: 'cnst_01M5CN0000000000000011A200',
      },
      options: { jobId: 'cnst_01M5CN0000000000000011A200' },
    });
    await expect(
      producer.enqueueConnectRedeem({ environmentId: 'env_x', shareTokenId: 'tok' }),
    ).rejects.toThrow(TypeError);
  });
});
