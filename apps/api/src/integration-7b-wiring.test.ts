/**
 * Workflow 7B Stage 4 (integration-7b): the missing hooks the Stage 3 builders reported, wired in
 * the shared files. The API container builds the real `ListService` (api-lists), and both processes
 * give the in-transaction graph indexer the configured blind-index key (api-graph). The worker's
 * list-import job gets the real `ListItemWriter` (api-importers). Nothing connects to anything.
 */
import { createKeyring, setDefaultKeyring, type Db } from '@openverify/db';
import type { WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';
import type { ProcessListImport } from './jobs/importers/process.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type {
  ListImportQueue,
  ListItemEmbedQueue,
  ListScreenQueue,
  VisionClient,
} from './ports.js';
import { unbuiltListItemWriter } from './services/lists/item-writer.js';
import {
  createRecordingQueue as createRecordingVerificationQueue,
  createRecordingReportRunQueue,
  fixedClock,
} from './test-support/fakes.js';
import { syntheticEnv } from './test-support/env.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import {
  startWorkers,
  type FakeableWorker,
  type RepeatableQueue,
  type WorkerProcessor,
} from './worker.js';

const listService = vi.hoisted(() => ({ createItem: vi.fn() }));
const createListService = vi.hoisted(() => vi.fn(() => listService));
vi.mock('./services/lists/item-writer.js', async (importActual) => ({
  ...(await importActual<typeof import('./services/lists/item-writer.js')>()),
  createListService,
}));
const useGraphIndexKey = vi.hoisted(() => vi.fn());
vi.mock('./services/graph/keys.js', async (importActual) => ({
  ...(await importActual<typeof import('./services/graph/keys.js')>()),
  useGraphIndexKey,
}));
vi.mock('./watchlists/reconcile.js', () => ({ reconcileWatchlistSources: vi.fn() }));
vi.mock('./network/reconcile.js', () => ({ reconcileNetworkSources: vi.fn() }));

const containers: Container[] = [];

afterEach(async () => {
  await Promise.all(containers.splice(0).map((container) => container.close()));
  setDefaultKeyring(undefined);
  vi.clearAllMocks();
});

function container() {
  const config = loadConfig(syntheticEnv({}));
  const built = createContainer(config, {
    verificationQueue: { ...createRecordingVerificationQueue(), close: () => Promise.resolve() },
    webhookDeliveries: {
      scheduleDelivery: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
    reportRuns: { ...createRecordingReportRunQueue(), close: () => Promise.resolve() },
  });
  containers.push(built);
  return { config, built };
}

describe('the API container (integration-7b hooks)', () => {
  it('serves the real list service on the configured blind-index key (C97.3)', () => {
    const { config } = container();

    expect(createListService).toHaveBeenCalledTimes(1);
    expect(createListService.mock.calls[0]).toEqual([
      expect.objectContaining({ blindIndexKey: config.blindIndexKey }),
    ]);
  });

  it('gives the graph indexer the configured key (C101.3)', () => {
    const { config } = container();

    expect(useGraphIndexKey).toHaveBeenCalledWith(config.blindIndexKey);
  });
});

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
const screens: ListScreenQueue = { enqueueListScreen: () => Promise.resolve() };
const imports: ListImportQueue = { enqueueListImport: () => Promise.resolve() };
const embeds: ListItemEmbedQueue = { enqueueListItemEmbed: () => Promise.resolve() };

interface FakeWorker extends FakeableWorker {
  name: string;
  processor: WorkerProcessor;
  options: WorkerOptions;
}

function workers(blindIndexKey: Uint8Array | undefined, importer: ProcessListImport) {
  const started: FakeWorker[] = [];
  const running = startWorkers({
    connection: { url: 'redis://127.0.0.1:1' },
    prefix: 'test',
    db: {} as Db,
    storage: createMemoryStorage(),
    keyring: createKeyring(randomBytes(32)),
    vision,
    sender,
    logger: createCapturingLogger(),
    concurrency: 1,
    sweepIntervalMs: 0,
    clock: fixedClock(),
    createQueue: () => createRecordingQueue<WebhookDeliveryJob>(),
    createRepeatableQueue: (): RepeatableQueue => ({
      upsertJobScheduler: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
    createWorker: (name, processor, options) => {
      const worker: FakeWorker = {
        name,
        processor: processor as WorkerProcessor,
        options,
        on: () => worker,
        close: () => Promise.resolve(),
      };
      started.push(worker);
      return worker;
    },
    lists: { screens, imports, embeds, process: { import: importer } },
    ...(blindIndexKey === undefined ? {} : { blindIndexKey }),
  });
  return { running, started };
}

describe('the worker (integration-7b hooks)', () => {
  it('gives the list-import job the real writer when it holds the key (C100.2)', async () => {
    const importer = vi.fn<ProcessListImport>(() => Promise.resolve({ status: 'ready' }));
    const key = new Uint8Array(32).fill(9);
    const { running, started } = workers(key, importer);

    await started
      .find((worker) => worker.name === 'list-import')
      ?.processor({
        id: 'x',
        data: { environmentId: 'env_01M5CJXHG0000000000000000A', importerId: 'mprt_1' },
      });

    expect(importer.mock.calls[0]?.[1].writer).not.toBe(unbuiltListItemWriter);
    expect(useGraphIndexKey).toHaveBeenCalledWith(key);
    await running.close();
  });
});
