/**
 * Workflow 9B Stage 1b, checkpoint (W): the `webhook-failure-alerts` sweep in the worker (C169.6,
 * C174.3): scheduled every 60 seconds only with `StartWorkersOptions.webhookAlerts`, each pass handed
 * the worker's database, clock and logger with the alert mailer and the console's URL; the pass is
 * `api-keys-webhooks`' (built: `jobs/repeatable/webhook-alerts.test.ts` holds its behaviour).
 */
import { createKeyring, type Db } from '@openverify/db';
import { createTestDatabase } from '@openverify/db/testing';
import type { WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  runWebhookFailureAlerts,
  type RunWebhookFailureAlerts,
} from './jobs/repeatable/webhook-alerts.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import {
  WEBHOOK_FAILURE_ALERTS_INTERVAL_MS,
  WEBHOOK_FAILURE_ALERTS_QUEUE,
} from './jobs/webhook-alert-queues.js';
import type { Mailer, VisionClient } from './ports.js';
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
const mailer: Mailer = { configured: true, send: () => Promise.resolve() };

interface FakeWorker extends FakeableWorker {
  name: string;
  processor: WorkerProcessor;
  options: WorkerOptions;
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
  return { options, workers, schedules };
}

describe('startWorkers: webhook-failure-alerts (C169.6, C174.3)', () => {
  it('is scheduled every 60 seconds, and only with the webhook alerts', async () => {
    const without = harness();
    await startWorkers(without.options).close();
    expect([...without.schedules.keys()]).not.toContain(WEBHOOK_FAILURE_ALERTS_QUEUE);

    const runAlerts = vi.fn<RunWebhookFailureAlerts>();
    const withAlerts = harness({ webhookAlerts: { runAlerts } });
    const running = startWorkers(withAlerts.options);
    expect(WEBHOOK_FAILURE_ALERTS_INTERVAL_MS).toBe(60_000);
    expect(withAlerts.schedules.get(WEBHOOK_FAILURE_ALERTS_QUEUE)).toEqual({
      every: WEBHOOK_FAILURE_ALERTS_INTERVAL_MS,
    });
    await running.close();
  });

  it('hands each pass the worker’s database, clock and logger, the mailer and the console URL', async () => {
    const runAlerts = vi.fn<RunWebhookFailureAlerts>(() =>
      Promise.resolve({ alerted: 1, notifications: 2, emailsQueued: 1, emailsSent: 1 }),
    );
    const { options, workers } = harness({
      webhookAlerts: { runAlerts, mailer, dashboardPublicUrl: 'https://console.example.test' },
    });
    const running = startWorkers(options);

    await workers
      .find((worker) => worker.name === WEBHOOK_FAILURE_ALERTS_QUEUE)
      ?.processor({ id: '1', data: { name: WEBHOOK_FAILURE_ALERTS_QUEUE } });

    expect(runAlerts).toHaveBeenCalledTimes(1);
    expect(runAlerts.mock.calls[0]?.[0]).toEqual({
      db: options.db,
      clock: options.clock,
      logger: options.logger,
      mailer,
      dashboardPublicUrl: 'https://console.example.test',
    });
    await running.close();
  });
});

describe('runWebhookFailureAlerts, built (C169.6)', () => {
  it('passes over a database with no alert on and reports nothing (built by api-keys-webhooks)', async () => {
    const database = await createTestDatabase();
    onTestFinished(() => database.close());
    const logger = createCapturingLogger();

    const result = await runWebhookFailureAlerts({ db: database.db, clock: fixedClock(), logger });

    expect(result).toEqual({ alerted: 0, notifications: 0, emailsQueued: 0, emailsSent: 0 });
    expect(logger.entries.map((entry) => entry.message)).not.toContain(
      'webhook failure alerts not built yet',
    );
  }, 120_000);
});
