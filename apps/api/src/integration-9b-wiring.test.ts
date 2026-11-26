/**
 * Workflow 9B Stage 4 (integration-9b): the missing wiring the Stage 3 builders reported, in the
 * shared process files. Both processes give the audit log's IP index (C168.6, `audit_log_ip_index`)
 * the configured blind-index key, as they give it to the graph indexer, so a process configured
 * other than through the environment still writes the index rows (api-access deviation). Nothing
 * connects to anything.
 */
import { createKeyring, setDefaultKeyring, type Db } from '@openverify/db';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { VisionClient } from './ports.js';
import {
  createRecordingQueue as createRecordingVerificationQueue,
  createRecordingReportRunQueue,
  fixedClock,
} from './test-support/fakes.js';
import { syntheticEnv } from './test-support/env.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import { startWorkers, type RepeatableQueue } from './worker.js';

const useAuditIpIndexKey = vi.hoisted(() => vi.fn());
vi.mock('@openverify/db', async (importActual) => ({
  ...(await importActual<typeof import('@openverify/db')>()),
  useAuditIpIndexKey,
}));
vi.mock('./watchlists/reconcile.js', () => ({ reconcileWatchlistSources: vi.fn() }));
vi.mock('./network/reconcile.js', () => ({ reconcileNetworkSources: vi.fn() }));

const containers: Container[] = [];

afterEach(async () => {
  await Promise.all(containers.splice(0).map((container) => container.close()));
  setDefaultKeyring(undefined);
  vi.clearAllMocks();
});

describe('the API container (integration-9b wiring)', () => {
  it('gives the audit log IP index the configured blind-index key (C168.6)', () => {
    const config = loadConfig(syntheticEnv({}));
    containers.push(
      createContainer(config, {
        verificationQueue: {
          ...createRecordingVerificationQueue(),
          close: () => Promise.resolve(),
        },
        webhookDeliveries: {
          scheduleDelivery: () => Promise.resolve(),
          close: () => Promise.resolve(),
        },
        reportRuns: { ...createRecordingReportRunQueue(), close: () => Promise.resolve() },
      }),
    );

    expect(useAuditIpIndexKey).toHaveBeenCalledWith(config.blindIndexKey);
  });
});

const unused = () => Promise.reject(new Error('unused'));
const vision = new Proxy({}, { get: () => unused }) as VisionClient;
const sender: WebhookSender = { send: unused, close: () => Promise.resolve() };

describe('the worker (integration-9b wiring)', () => {
  it('gives the audit log IP index its blind-index key when it holds one (C168.6)', async () => {
    const key = new Uint8Array(32).fill(7);
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
      createWorker: () => ({ on: () => undefined, close: () => Promise.resolve() }),
      blindIndexKey: key,
    });

    expect(useAuditIpIndexKey).toHaveBeenCalledWith(key);
    await running.close();
  });
});
