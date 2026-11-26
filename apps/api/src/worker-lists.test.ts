/**
 * C99.4, C99.7, C100.2, C107.1, C107.2 (Workflow 7B Stage 1b (L)): `startWorkers` with the list
 * producers starts the `list-screen`, `list-import` and `list-item-embed` workers and schedules
 * their sweeps. Without them, none exists. The database is never reached here: the workers are
 * fakes, and each job goes to its owner's processor.
 */
import { createKeyring, type Db } from '@openverify/db';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessListImport } from './jobs/importers/process.js';
import type { ProcessListItemEmbed } from './jobs/lists/embed.js';
import type { ProcessListScreen } from './jobs/lists/screen.js';
import { PermanentJobError } from './jobs/process-verification.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type {
  ListImportQueue,
  ListItemEmbedQueue,
  ListRescreenQueue,
  ListScreenQueue,
  VisionClient,
} from './ports.js';
import { unbuiltBiometricListMatcher } from './services/lists/biometric/index.js';
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

const screens: ListScreenQueue = { enqueueListScreen: () => Promise.resolve() };
const imports: ListImportQueue = { enqueueListImport: () => Promise.resolve() };
const embeds: ListItemEmbedQueue = { enqueueListItemEmbed: () => Promise.resolve() };

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
const NAMES = ['list-screen', 'list-import', 'list-item-embed'];
const SWEEPS = ['list-screen-sweep', 'list-import-sweep', 'list-item-embed-sweep'];

describe('startWorkers: list-rescreen (C127.12)', () => {
  const rescreens: ListRescreenQueue = { enqueueListRescreen: () => Promise.resolve() };

  it('starts the job and its sweep with the lists, and with no workflow', async () => {
    const started = harness({ lists: { screens, imports, embeds, rescreens } });

    await startWorkers(started.options).close();

    expect(started.workers.map((worker) => worker.name)).toContain('list-rescreen');
    expect(started.repeatables).toContain('list-rescreen-sweep');
  });

  it('starts neither without its producer', async () => {
    const started = harness({ lists: { screens, imports, embeds } });

    await startWorkers(started.options).close();

    expect(started.workers.map((worker) => worker.name)).not.toContain('list-rescreen');
    expect(started.repeatables).not.toContain('list-rescreen-sweep');
  });
});

describe('startWorkers: the list workers and sweeps (C107.1, C107.2)', () => {
  it('starts them only with the list producers', async () => {
    const without = harness();
    await startWorkers(without.options).close();
    expect(without.workers.map((worker) => worker.name)).not.toEqual(
      expect.arrayContaining([NAMES[0]]),
    );
    expect(without.repeatables).not.toEqual(expect.arrayContaining([SWEEPS[0]]));

    const withLists = harness({ lists: { screens, imports, embeds } });
    const running = startWorkers(withLists.options);

    expect(withLists.workers.map((worker) => worker.name)).toEqual(
      expect.arrayContaining([...NAMES, ...SWEEPS]),
    );
    expect(withLists.repeatables).toEqual(expect.arrayContaining(SWEEPS));
    await running.close();
  });

  it('hands each job to its processor with the worker’s keys', async () => {
    const screen = vi.fn<ProcessListScreen>(() => Promise.resolve({ status: 'screened' }));
    const list = vi.fn<ProcessListImport>(() => Promise.resolve({ status: 'ready' }));
    const embed = vi.fn<ProcessListItemEmbed>(() => Promise.resolve({ status: 'active' }));
    const blindIndexKey = new Uint8Array(32).fill(7);
    const { options, workers } = harness({
      lists: { screens, imports, embeds, process: { screen, import: list, embed } },
      blindIndexKey,
    });
    const running = startWorkers(options);
    const run = (name: string, data: unknown) =>
      workers.find((worker) => worker.name === name)?.processor({ id: 'x', data });

    await expect(
      run('list-screen', { environmentId: ENVIRONMENT, inquiryId: 'inq_1' }),
    ).resolves.toEqual({ status: 'screened' });
    await expect(
      run('list-import', { environmentId: ENVIRONMENT, importerId: 'mprt_1' }),
    ).resolves.toEqual({ status: 'ready' });
    await expect(
      run('list-item-embed', { environmentId: ENVIRONMENT, itemId: 'lifc_1' }),
    ).resolves.toEqual({ status: 'active' });

    expect(screen.mock.calls[0]?.[1]).toMatchObject({ blindIndexKey });
    expect(list.mock.calls[0]?.[1]).toMatchObject({ blindIndexKey });
    expect(embed).toHaveBeenCalledTimes(1);
    await running.close();
  });

  it('gives the screening job the real biometric matcher, and the embed job vision (C99.7)', async () => {
    const screen = vi.fn<ProcessListScreen>(() => Promise.resolve({ status: 'screened' }));
    const embed = vi.fn<ProcessListItemEmbed>(() => Promise.resolve({ status: 'skipped' }));
    const { options, workers } = harness({
      lists: { screens, imports, embeds, process: { screen, embed } },
    });
    const running = startWorkers(options);
    const run = (name: string, data: unknown) =>
      workers.find((worker) => worker.name === name)?.processor({ id: 'x', data });

    await run('list-screen', { environmentId: ENVIRONMENT, inquiryId: 'inq_1' });
    await run('list-item-embed', { environmentId: ENVIRONMENT, itemId: 'lifc_1' });

    const biometric = screen.mock.calls[0]?.[1].biometric;
    expect(biometric).toBeDefined();
    expect(biometric).not.toBe(unbuiltBiometricListMatcher);
    expect(embed.mock.calls[0]?.[1].vision).toBe(vision);
    await running.close();
  });

  it('turns a permanent failure into an unrecoverable one, so BullMQ does not retry it', async () => {
    const screen = vi.fn<ProcessListScreen>(() =>
      Promise.reject(new PermanentJobError('invalid_template')),
    );
    const { options, workers } = harness({
      lists: { screens, imports, embeds, process: { screen } },
    });
    const running = startWorkers(options);

    await expect(
      workers
        .find((worker) => worker.name === 'list-screen')
        ?.processor({ id: 'x', data: { environmentId: ENVIRONMENT, inquiryId: 'inq_1' } }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await running.close();
  });
});
