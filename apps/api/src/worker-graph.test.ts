/**
 * C101.3, C101.5, C101.6, C102.4, C107.1, C107.2 (Workflow 7B Stage 1b (G)): `startWorkers` with the
 * graph producers starts the `graph-index` and `graph-query` workers and schedules the
 * `graph-index-sweep`, `graph-query-sweep`, `graph-backfill` and `graph-components` jobs. Without
 * them, none exists. The database is never reached here: the workers are fakes, and each job goes to
 * its owner's processor.
 */
import { createKeyring, type Db } from '@openverify/db';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessGraphIndex } from './jobs/graph/index-job.js';
import type { ProcessGraphQuery } from './jobs/graph/query.js';
import { PermanentJobError } from './jobs/process-verification.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { VisionClient } from './ports.js';
import {
  createRecordingGraphIndexQueue,
  createRecordingGraphQueryQueue,
  fixedClock,
} from './test-support/fakes.js';
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

const ENVIRONMENT = 'env_01M5CJXHG0000000000000000A';
const NAMES = ['graph-index', 'graph-query'];
const JOBS = ['graph-index-sweep', 'graph-query-sweep', 'graph-backfill', 'graph-components'];

describe('startWorkers: the graph workers and jobs (C107.1, C107.2)', () => {
  it('starts them only with the graph producers', async () => {
    const without = harness();
    await startWorkers(without.options).close();
    const names = without.workers.map((worker) => worker.name);
    for (const name of [...NAMES, ...JOBS]) {
      expect(names).not.toContain(name);
    }

    const withGraph = harness({
      graph: { index: createRecordingGraphIndexQueue(), queries: createRecordingGraphQueryQueue() },
    });
    const running = startWorkers(withGraph.options);

    expect(withGraph.workers.map((worker) => worker.name)).toEqual(
      expect.arrayContaining([...NAMES, ...JOBS]),
    );
    expect(withGraph.repeatables).toEqual(expect.arrayContaining(JOBS));
    await running.close();
  });

  it('hands each job to its processor with the worker’s keys', async () => {
    const index = vi.fn<ProcessGraphIndex>(() => Promise.resolve({ status: 'indexed' }));
    const query = vi.fn<ProcessGraphQuery>(() => Promise.resolve({ status: 'completed' }));
    const blindIndexKey = new Uint8Array(32).fill(9);
    const { options, workers } = harness({
      graph: {
        index: createRecordingGraphIndexQueue(),
        queries: createRecordingGraphQueryQueue(),
        process: { index, query },
      },
      blindIndexKey,
    });
    const running = startWorkers(options);
    const run = (name: string, data: unknown) =>
      workers.find((worker) => worker.name === name)?.processor({ id: 'x', data });

    await expect(
      run('graph-index', { environmentId: ENVIRONMENT, inquiryId: 'inq_1' }),
    ).resolves.toEqual({ status: 'indexed' });
    await expect(
      run('graph-query', { environmentId: ENVIRONMENT, graphQueryId: 'grphq_1' }),
    ).resolves.toEqual({ status: 'completed' });

    expect(index.mock.calls[0]?.[0]).toEqual({ environmentId: ENVIRONMENT, inquiryId: 'inq_1' });
    expect(index.mock.calls[0]?.[1]).toMatchObject({ blindIndexKey, keyring: options.keyring });
    expect(query.mock.calls[0]?.[1]).toHaveProperty('events');
    await running.close();
  });

  it('turns a permanent failure into an unrecoverable one', async () => {
    const index = vi.fn<ProcessGraphIndex>(() =>
      Promise.reject(new PermanentJobError('invalid_template')),
    );
    const { options, workers } = harness({
      graph: {
        index: createRecordingGraphIndexQueue(),
        queries: createRecordingGraphQueryQueue(),
        process: { index },
      },
    });
    const running = startWorkers(options);

    await expect(
      workers
        .find((worker) => worker.name === 'graph-index')
        ?.processor({ id: 'x', data: { environmentId: ENVIRONMENT, inquiryId: 'inq_1' } }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await running.close();
  });
});
