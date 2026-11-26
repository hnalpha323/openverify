/**
 * C137.4, C143.2 (Workflow 8B Stage 1b (C)): `startWorkers` with the case options starts the
 * `case-bulk` worker, which hands each job to `api-cases`' processor (`services/cases/bulk/process.ts`).
 * Checkpoint (F) (C135.3, C135.5, C138.1): it starts `case-export`, `case-attachment-scan` and
 * `case-rendition` too, each handing its job to `api-case-files`' processor (`jobs/cases/`), and
 * schedules `case-export-sweep`. Without them, none exists. The database is never reached: the
 * workers are fakes.
 */
import { createKeyring, type Db } from '@openverify/db';
import type { WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
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
  options: WorkerOptions;
}

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

describe('startWorkers: case-bulk (C137.4)', () => {
  it('starts the job with the case options, and hands each job to its processor', async () => {
    const bulk = vi.fn(() => Promise.resolve());
    const started = harness({ cases: { process: { bulk } } });
    const running = startWorkers(started.options);
    const worker = started.workers.find(({ name }) => name === 'case-bulk');
    const job = {
      environmentId: 'env_01M5CJXHG0000000000000000A',
      bulkActionId: 'cblk_01M5CJXHG0000000000000000A',
    };

    await worker?.processor({ id: 'cblk_01M5CJXHG0000000000000000A', data: job });
    await running.close();

    expect(worker).toBeDefined();
    // The job writes each case's events: without the publisher it would leave the action pending.
    expect(bulk).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ db: started.options.db, events: expect.any(Object) as unknown }),
    );
  });

  it('starts none without them', async () => {
    const started = harness();

    await startWorkers(started.options).close();

    expect(started.workers.map(({ name }) => name)).not.toContain('case-bulk');
  });
});

describe('startWorkers: the case sweeps (C132.6, C133.6; checkpoint (Q))', () => {
  it('schedules case-sla and case-reassign with the case options, and neither without them', async () => {
    const scheduled = (overrides: Partial<StartWorkersOptions>) => {
      const names: string[] = [];
      const started = harness({
        ...overrides,
        createRepeatableQueue: (name): RepeatableQueue => ({
          upsertJobScheduler: () => {
            names.push(name);
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
      });
      return { started, names };
    };
    const withCases = scheduled({ cases: {} });
    const without = scheduled({});

    await startWorkers(withCases.started.options).close();
    await startWorkers(without.started.options).close();

    expect(withCases.names).toEqual(expect.arrayContaining(['case-sla', 'case-reassign']));
    expect(withCases.started.workers.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['case-sla', 'case-reassign']),
    );
    expect(without.names).not.toContain('case-sla');
    expect(without.names).not.toContain('case-reassign');
  });
});

describe('startWorkers: the case file jobs (C135.3, C135.5, C138.1; checkpoint (F))', () => {
  it('starts each with the case options, and hands each job to its processor', async () => {
    const process = {
      export: vi.fn(() => Promise.resolve()),
      scan: vi.fn(() => Promise.resolve()),
      rendition: vi.fn(() => Promise.resolve()),
    };
    const started = harness({ cases: { process } });
    const running = startWorkers(started.options);
    const env = 'env_01M5CJXHG0000000000000000A';
    const jobs = [
      ['case-export', { environmentId: env, caseExportId: 'cexp_01M5CJXHG0000000000000000A' }],
      [
        'case-attachment-scan',
        { environmentId: env, caseAttachmentId: 'catt_01M5CJXHG0000000000000000A' },
      ],
      ['case-rendition', { environmentId: env, sourceId: 'file_01M5CJXHG0000000000000000A' }],
    ] as const;

    for (const [name, data] of jobs) {
      const worker = started.workers.find((candidate) => candidate.name === name);
      expect(worker, name).toBeDefined();
      await worker?.processor({ id: name, data });
    }
    await running.close();

    // By identity: the vision fake is a proxy that equality would walk.
    for (const [call, data] of [
      [process.export, jobs[0][1]],
      [process.scan, jobs[1][1]],
      [process.rendition, jobs[2][1]],
    ] as const) {
      const [job, deps] = call.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(job).toEqual(data);
      expect(deps.db).toBe(started.options.db);
      expect(deps.storage).toBe(started.options.storage);
      expect(deps.keyring).toBe(started.options.keyring);
      expect(deps.vision).toBe(started.options.vision);
    }
  });

  it('starts none without them, and schedules the export sweep only with them', async () => {
    const names: string[] = [];
    const scheduled = (overrides: Partial<StartWorkersOptions>) =>
      harness({
        ...overrides,
        createRepeatableQueue: (name): RepeatableQueue => ({
          upsertJobScheduler: () => {
            names.push(`${overrides.cases === undefined ? 'without' : 'with'}:${name}`);
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
      });
    const without = scheduled({});
    const withCases = scheduled({ cases: {} });

    await startWorkers(without.options).close();
    await startWorkers(withCases.options).close();

    expect(without.workers.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(['case-export']),
    );
    expect(names).toContain('with:case-export-sweep');
    expect(names).not.toContain('without:case-export-sweep');
  });
});
