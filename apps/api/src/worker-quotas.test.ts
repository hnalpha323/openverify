/**
 * C251.1, C251.2 (Workflow 11B, `integration-11b`; quotas' missing worker hook): the worker schedules
 * the `quota-sweep` (every 15 s) and, when a queue recovers lost work, the `quota-recovery` (every
 * 60 s) only when it is given the quota producers, which are the UNWRAPPED ones (an admitted
 * producer would ask the admission again and hold the row it just admitted). The producers'
 * admission and the sweep read the install's limits (`OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`, and
 * Phase 8's `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP` as the workflow-step default) through
 * `installQueueLimitsOf`, so an install that raises its ceiling is admitted up to it.
 */
import { randomBytes } from 'node:crypto';
import { createKeyring, type Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { installQueueLimitsOf } from './jobs/admitted-producers.js';
import { QUOTA_RECOVERY_QUEUE, QUOTA_SWEEP_QUEUE } from './jobs/quota-sweep.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { VisionClient } from './ports.js';
import { fixedClock } from './test-support/fakes.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import { startWorkers, type RepeatableQueue, type StartWorkersOptions } from './worker.js';

const unused = () => Promise.reject(new Error('unused'));
const vision = new Proxy({}, { get: () => unused }) as VisionClient;
const sender: WebhookSender = { send: unused, close: () => Promise.resolve() };

function harness(overrides: Partial<StartWorkersOptions> = {}) {
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
    createWorker: () => {
      const worker = { on: () => worker, close: () => Promise.resolve() };
      return worker;
    },
    ...overrides,
  };
  return { options, schedules };
}

const enqueued = () => Promise.resolve();

describe('startWorkers: the quota sweep and recovery (C251.1)', () => {
  it('schedules neither without the quota producers', async () => {
    const off = harness();
    await startWorkers(off.options).close();
    expect([...off.schedules.keys()]).not.toContain(QUOTA_SWEEP_QUEUE);
    expect([...off.schedules.keys()]).not.toContain(QUOTA_RECOVERY_QUEUE);
  });

  it('schedules the sweep every 15 s, and the recovery every 60 s once a queue recovers lost work', async () => {
    const sweepOnly = harness({
      quotas: {
        limits: { ceiling: 50 },
        producers: { verifications: { enqueueProcessVerification: enqueued } },
      },
    });
    await startWorkers(sweepOnly.options).close();
    expect(sweepOnly.schedules.get(QUOTA_SWEEP_QUEUE)).toEqual({ every: 15_000 });
    expect(sweepOnly.schedules.has(QUOTA_RECOVERY_QUEUE)).toBe(false);

    const both = harness({
      quotas: {
        limits: { ceiling: 50 },
        producers: {
          verifications: { enqueueProcessVerification: enqueued },
          reportRuns: { enqueueReportRun: enqueued },
          connectRedeems: { enqueueConnectRedeem: enqueued },
          accountExports: { enqueueAccountExport: enqueued },
          integrityDecodes: { enqueueIntegrityDecode: enqueued },
        },
      },
    });
    await startWorkers(both.options).close();
    expect(both.schedules.get(QUOTA_SWEEP_QUEUE)).toEqual({ every: 15_000 });
    expect(both.schedules.get(QUOTA_RECOVERY_QUEUE)).toEqual({ every: 60_000 });
  });
});

describe('installQueueLimitsOf (C251.2)', () => {
  it('reads the ceiling and the workflow-step default from the configuration', () => {
    expect(
      installQueueLimitsOf({ queueInFlightCapMax: 7, workflows: { inFlightCap: 30 } }),
    ).toEqual({ ceiling: 7, workflowDefault: 30 });
  });
});
