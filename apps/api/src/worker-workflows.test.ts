/**
 * C117, C118.1, C119.3, C143.2 (F02, F11; Workflow 8A Stage 1b (E)): `startWorkers` with the engine's
 * producers starts the four engine workers, gives the event publisher its schedulers and builds the
 * services once. Without them, none exists. The database is never reached: the workers are fakes.
 */
import { randomBytes } from 'node:crypto';
import { createKeyring, type Db } from '@openverify/db';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { PermanentJobError } from './jobs/process-verification.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type { VisionClient } from './ports.js';
import { syntheticEnv } from './test-support/env.js';
import { fixedClock } from './test-support/fakes.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import {
  checkValkeyAtStart,
  logWorkflowCodeRunnerAtStart,
  startWorkers,
  workerProviderBindings,
  type FakeableWorker,
  type RepeatableQueue,
  type StartWorkersOptions,
  type WorkerProcessor,
} from './worker.js';
import type { WorkflowServices } from './workflows/services.js';

const publisher = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('./events/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./events/index.js')>();
  return {
    ...actual,
    createEventPublisher: (options: Parameters<typeof actual.createEventPublisher>[0]) => {
      publisher.options.push(options);
      return actual.createEventPublisher(options);
    },
  };
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
    createRepeatableQueue: (name): RepeatableQueue => {
      repeatables.push(name);
      return {
        upsertJobScheduler: () => Promise.resolve(),
        close: () => Promise.resolve(),
      };
    },
    ...overrides,
  };
  return { running: startWorkers(options), workers, repeatables };
}

const stepQueue = { enqueueWorkflowStep: vi.fn(() => Promise.resolve()) };
const triggerQueue = { enqueueWorkflowTrigger: vi.fn(() => Promise.resolve()) };
const waitQueue = { enqueueWorkflowWaitMatch: vi.fn(() => Promise.resolve()) };

function workflows(extra: object = {}) {
  return {
    createServices: vi.fn(() => ({}) as WorkflowServices),
    steps: stepQueue,
    triggers: triggerQueue,
    waitMatches: waitQueue,
    ...extra,
  };
}

const ENGINE_QUEUES = [
  'workflow-step',
  'workflow-step-batch',
  'workflow-trigger',
  'workflow-wait-match',
];

describe('startWorkers: the engine (C143.2)', () => {
  it('starts no engine worker or job without its producers', async () => {
    const { running, workers, repeatables } = harness();

    expect(workers.map(({ name }) => name)).not.toEqual(expect.arrayContaining(ENGINE_QUEUES));
    expect(repeatables).not.toContain('workflow-step-sweep');
    await running.close();
  });

  it('starts the four workers and the repeatable jobs with them', async () => {
    const { running, workers, repeatables } = harness({ workflows: workflows() });

    expect(workers.map(({ name }) => name)).toEqual(expect.arrayContaining(ENGINE_QUEUES));
    expect(repeatables).toEqual(
      expect.arrayContaining(['workflow-step-sweep', 'publisher-rights']),
    );
    await running.close();
  });

  it('builds the services once, with the worker’s publisher (F11)', async () => {
    const options = workflows();
    const { running } = harness({ workflows: options });

    expect(options.createServices).toHaveBeenCalledTimes(1);
    expect(options.createServices.mock.calls[0]).toHaveLength(1);
    await running.close();
  });

  it('gives the publisher its schedulers (F02: the worker’s construction site)', async () => {
    publisher.options.length = 0;
    const { running } = harness({ workflows: workflows() });

    expect(publisher.options[0]).toMatchObject({
      workflowTriggers: triggerQueue,
      workflowSteps: waitQueue,
    });
    await running.close();
  });

  it('hands each job to its processor', async () => {
    const step = vi.fn(() => Promise.resolve());
    const trigger = vi.fn(() => Promise.resolve());
    const waitMatch = vi.fn(() => Promise.resolve());
    const { running, workers } = harness({
      workflows: workflows({ process: { step, trigger, waitMatch } }),
    });
    const run = (name: string, data: unknown) =>
      workers
        .find((worker) => worker.name === name)
        ?.processor({ data, attemptsMade: 0, opts: {} });

    await run('workflow-step', { stepId: 'a' });
    await run('workflow-step-batch', { stepId: 'b' });
    await run('workflow-trigger', { deliveryId: 'c' });
    await run('workflow-wait-match', { eventId: 'd' });

    expect(step.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      { stepId: 'a' },
      { stepId: 'b' },
    ]);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(waitMatch).toHaveBeenCalledTimes(1);
    await running.close();
  });

  it('closes the code runner when it stops, because idle children hold the process (C123.3)', async () => {
    const close = vi.fn(() => Promise.resolve());
    const services = { egress: { codeRunner: { close } } } as unknown as WorkflowServices;
    const { running } = harness({ workflows: workflows({ createServices: () => services }) });

    await running.close();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('gives the engine the install’s in-flight cap (C117.8)', async () => {
    const step = vi.fn<(job: unknown, deps: { inFlightCap?: number }) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const { running, workers } = harness({
      workflows: workflows({ inFlightCap: 7, process: { step } }),
    });

    await workers
      .find((worker) => worker.name === 'workflow-step')
      ?.processor({ data: { stepId: 'a' }, attemptsMade: 0, opts: {} });

    expect(step.mock.calls[0]?.[1].inFlightCap).toBe(7);
    await running.close();
  });

  it('turns a permanent failure into an unrecoverable one', async () => {
    const { running, workers } = harness({
      workflows: workflows({
        process: { step: () => Promise.reject(new PermanentJobError('synthetic_code')) },
      }),
    });

    await expect(
      workers
        .find((worker) => worker.name === 'workflow-step')
        ?.processor({ data: {}, attemptsMade: 0, opts: {} }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await running.close();
  });
});

describe('workerProviderBindings (C126.6, decision 76)', () => {
  const TWILIO = {
    OPENVERIFY_PROVIDER_SMS_PRODUCTION: 'twilio',
    OPENVERIFY_TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`,
    OPENVERIFY_TWILIO_API_KEY_SID: `SK${'0'.repeat(32)}`,
    OPENVERIFY_TWILIO_API_KEY_SECRET: 'change-me-synthetic-twilio-key-secret-canary',
    OPENVERIFY_TWILIO_FROM: '+15555550100',
  };

  it('binds the SMS sender with Twilio’s credentials, for workflow messages', () => {
    const config = loadConfig(syntheticEnv(TWILIO), { process: 'worker' });

    expect(workerProviderBindings(config, {}).production.sms).toMatchObject({
      id: 'twilio',
      sandbox: false,
    });
  });

  it('binds the sandbox Slack sender to a sandbox environment', () => {
    const config = loadConfig(syntheticEnv({ OPENVERIFY_PROVIDER_SLACK_SANDBOX: 'sandbox' }), {
      process: 'worker',
    });

    expect(workerProviderBindings(config, {}).sandbox.slack).toMatchObject({ sandbox: true });
  });
});

describe('logWorkflowCodeRunnerAtStart (C123.3, P17)', () => {
  it('warns about the pool in production, with no value in the line', () => {
    const logger = createCapturingLogger();

    logWorkflowCodeRunnerAtStart('production', { kind: 'pool' }, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({ level: 'warn' });
  });

  it('says nothing about the code-runner service', () => {
    const logger = createCapturingLogger();

    logWorkflowCodeRunnerAtStart(
      'production',
      { kind: 'socket', path: '/run/openverify/code-runner.sock' },
      logger,
    );

    expect(logger.entries).toEqual([]);
  });

  it('says nothing outside production', () => {
    const logger = createCapturingLogger();

    logWorkflowCodeRunnerAtStart('development', { kind: 'pool' }, logger);

    expect(logger.entries).toEqual([]);
  });
});

describe('checkValkeyAtStart (C117.10, decision 18)', () => {
  it('asks the owner’s check', async () => {
    const check = vi.fn(() => Promise.resolve());

    await checkValkeyAtStart(check, createCapturingLogger());

    expect(check).toHaveBeenCalledTimes(1);
  });

  it('never refuses to start: a failed check is a logged error', async () => {
    const logger = createCapturingLogger();

    await expect(
      checkValkeyAtStart(() => Promise.reject(new Error('synthetic')), logger),
    ).resolves.toBeUndefined();

    expect(logger.entries[0]).toMatchObject({ level: 'error' });
    expect(JSON.stringify(logger.entries)).not.toContain('synthetic');
  });
});
