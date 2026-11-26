/**
 * Workflow 11B Stage 1b (D) (foundation-11b): the access export's plumbing (C253) and the watchlist
 * sync's validator step (C254.2).
 *
 * - The export routes (dsar-export's) and the UN opt-in routes (ingestion-11b's, Stage 1a amendment
 *   51) frozen at 501 with contracts-11b's schemas, registered as plugins so they are in the OpenAPI
 *   document.
 * - The `account-export` queue: its producer (ids only, the export's id as the job id) and its worker,
 *   whose stub processor fails loudly until dsar-export builds it.
 * - The hooks: the export deletion first in the inquiry and account cascades and in the C16 pass
 *   (C253.4, dsar-export's `account-export/hooks.ts`), and the validator step before a watchlist
 *   download (ingestion-11b's `watchlists/conditional.ts`). Each is one call in a shared file.
 * - Each stub keeps today's behaviour; its owner removes its case when it builds it.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createKeyring, type Db } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountExportQueue, type AccountExportJob } from './jobs/account-export-queues.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { VisionClient } from './ports.js';
import { fixedClock } from './test-support/fakes.js';
import { bearer, createTestApi, type TestApi } from './test-support/harness.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import {
  startWorkers,
  type FakeableWorker,
  type RepeatableQueue,
  type StartWorkersOptions,
  type WorkerProcessor,
} from './worker.js';

const AEXP = 'aexp_01M5CN0000000000000011B200';
const ENV = 'env_01M5CN0000000000000011B400';

const source = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

describe('the access export routes, frozen by foundation-11b and built by dsar-export (C253.1)', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('validates the ids first: an account, an export and a listed file', async () => {
    const get = (url: string) => api.app.inject({ method: 'GET', url, headers: bearer(api.token) });
    expect((await get('/api/v1/account-exports/exp_nope')).statusCode).toBe(400);
    expect(
      (await get(`/api/v1/account-exports/${AEXP}/files/inq_01M5CN0000000000000011B500`))
        .statusCode,
    ).toBe(400);
  });

  it('lists the four routes in the OpenAPI document', async () => {
    const response = await api.app.inject({ method: 'GET', url: '/openapi.json' });
    const paths = Object.keys(response.json<{ paths: Record<string, unknown> }>().paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/accounts/{id}/export',
        '/api/v1/account-exports/{id}',
        '/api/v1/account-exports/{id}/manifest',
        '/api/v1/account-exports/{id}/files/{fileId}',
      ]),
    );
  });
});

describe('the account-export producer (C253.2)', () => {
  it('enqueues ids only, the export’s id as the job id, one attempt', async () => {
    const queue = createRecordingQueue<AccountExportJob>();
    const producer = createAccountExportQueue({ queue });
    await producer.enqueueAccountExport({ environmentId: ENV, exportId: AEXP });
    expect(queue.jobs).toEqual([
      {
        name: 'account-export',
        data: { environmentId: ENV, exportId: AEXP },
        options: { attempts: 1, removeOnComplete: true, removeOnFail: true, jobId: AEXP },
      },
    ]);
    await expect(
      producer.enqueueAccountExport({ environmentId: ENV, exportId: 'exp_nope' }),
    ).rejects.toThrow(TypeError);
    await producer.close();
    expect(queue.closed).toBe(true);
  });
});

const unused = () => Promise.reject(new Error('unused'));
const vision = new Proxy({}, { get: () => unused }) as VisionClient;
const sender: WebhookSender = { send: unused, close: () => Promise.resolve() };

interface FakeWorker extends FakeableWorker {
  name: string;
  processor: WorkerProcessor;
}

function workerHarness(overrides: Partial<StartWorkersOptions> = {}) {
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
  return { options, workers };
}

describe('the account-export worker (C253.2)', () => {
  it('starts with its options, and its job fails loudly until dsar-export builds it', async () => {
    const off = workerHarness();
    await startWorkers(off.options).close();
    expect(off.workers.map((worker) => worker.name)).not.toContain('account-export');

    const on = workerHarness({ accountExport: {} });
    const running = startWorkers(on.options);
    const cut = on.workers.find((worker) => worker.name === 'account-export');
    expect(cut).toBeDefined();
    // The worker strips the failure's data (`withoutFailureData`): the job fails, its message kept
    // out of Valkey.
    await expect(
      cut?.processor({ data: { environmentId: ENV, exportId: AEXP } }),
    ).rejects.toThrow();
    await running.close();
  });

  it('runs the processor it is given with the worker’s stores', async () => {
    const seen: unknown[] = [];
    const on = workerHarness({
      accountExport: {
        process: (job, deps) => {
          seen.push([job, typeof deps.storage.get]);
          return Promise.resolve({ outcome: 'skipped' as const });
        },
      },
    });
    const running = startWorkers(on.options);
    const cut = on.workers.find((worker) => worker.name === 'account-export');
    await cut?.processor({ data: { environmentId: ENV, exportId: AEXP } });
    expect(seen).toEqual([[{ environmentId: ENV, exportId: AEXP }, 'function']]);
    await running.close();
  });
});

describe('the (D) hooks, each one call in a shared file to its owner’s stub', () => {
  it.each([
    [
      'services/redaction.ts',
      'accountExportHooks.subjectRedactedInTx(',
      'account-export/hooks.js',
      // The inquiry and account cascades, and since KP11-27 (Workflow 11F) the report and
      // transaction redactions.
      4,
    ],
    ['services/retention.ts', 'accountExportHooks.retention(', 'account-export/hooks.js', 1],
    ['watchlists/sync.ts', 'checkSourceConditionally(', './conditional.js', 1],
  ] as const)('%s calls %s', (file, callName, module, count) => {
    const text = source(file);
    expect(text.split(callName).length - 1).toBe(count);
    expect(text).toContain(module);
  });

  it('runs the export deletion before anything else the redaction cascades and the C16 pass do', () => {
    const redaction = source('services/redaction.ts');
    for (const [start, first] of [
      ['async function redactInquiry(', 'lockInquiryTransactions('],
      ['async function redactAccount(', 'lockAccountTransactions('],
    ] as const) {
      const body = redaction.slice(redaction.indexOf(start));
      const hook = body.indexOf('accountExportHooks.subjectRedactedInTx(');
      // After the transactions' lock, which always comes first, and before any record is touched.
      expect(hook).toBeGreaterThan(body.indexOf(first));
      expect(hook).toBeLessThan(body.indexOf('Records(tx, environmentId'));
    }
    const retention = source('services/retention.ts');
    const pass = retention.slice(retention.indexOf('export async function runRetention('));
    expect(pass.indexOf('accountExportHooks.retention(')).toBeLessThan(
      pass.indexOf('redactDueInquiries('),
    );
  });
});
