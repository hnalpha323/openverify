/**
 * Workflow 9A Stage 1b, checkpoint (S): the flow's jobs in the worker (C150.9, C152.2, C174.3):
 * - the `flow-signal-snapshot` worker, given the deps the `inquiry-signals` processor receives, and
 *   the `flow-action-sweep`, both only with the flow's producer;
 * - the processor turns a permanent failure into BullMQ's `UnrecoverableError`, and the stub fails
 *   permanently, so nothing reads as computed until `api-flow-actions` builds it;
 * - the sweep is `unbuiltRepeatableJob`'s every 15 s;
 * - the producer keys one job per branch entry and refuses a malformed one.
 */
import { createKeyring, type Db } from '@openverify/db';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createFlowSignalSnapshotQueue,
  FLOW_ACTION_SWEEP_INTERVAL_MS,
  FLOW_ACTION_SWEEP_QUEUE,
  FLOW_SIGNAL_SNAPSHOT_JOB_OPTIONS,
  FLOW_SIGNAL_SNAPSHOT_QUEUE,
} from './jobs/flow-queues.js';
import {
  FLOW_SIGNAL_SNAPSHOT_NOT_BUILT,
  type ProcessFlowSignalSnapshot,
} from './jobs/flow/signal-snapshot.js';
import { PermanentJobError } from './jobs/errors.js';
import { phase9RepeatableJobs } from './jobs/repeatable/index.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import { requestSignalSnapshot } from './flow-actions/signal-snapshot.js';
import type { TransactionalEventPublisher } from './events/index.js';
import type { FlowSignalSnapshotJob, VisionClient, WorkflowStepQueue } from './ports.js';
import { createInMemoryNetworkSnapshots, fixedClock } from './test-support/fakes.js';
import type { WebhookSender } from './webhooks/http-sender.js';
import type { WebhookDeliveryJob } from './webhooks/queue.js';
import {
  flowSignalSnapshotProcessor,
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

const job: FlowSignalSnapshotJob = {
  environmentId: 'env_01M5CJXHG0000000000000000A',
  inquiryId: 'inq_01M5CK16P0D13FXHZSS4TCFBVH',
  stepRecordSeq: 3,
  names: ['inquiry/vpn_detected', 'inquiry/bot_score'],
};

const recordingSnapshots = () => {
  const jobs: FlowSignalSnapshotJob[] = [];
  return {
    jobs,
    enqueueFlowSignalSnapshot: (queued: FlowSignalSnapshotJob) => {
      jobs.push(queued);
      return Promise.resolve();
    },
  };
};

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

describe('startWorkers: the flow-signal-snapshot worker and the flow-action-sweep (C150.9, C152.2)', () => {
  it('starts both only with the flow producer', async () => {
    const without = harness();
    await startWorkers(without.options).close();
    expect(without.workers.map((worker) => worker.name)).not.toContain(FLOW_SIGNAL_SNAPSHOT_QUEUE);
    expect(without.repeatables).not.toContain(FLOW_ACTION_SWEEP_QUEUE);

    const withFlow = harness({ flow: { signalSnapshots: recordingSnapshots() } });
    const running = startWorkers(withFlow.options);
    expect(withFlow.workers.map((worker) => worker.name)).toEqual(
      expect.arrayContaining([FLOW_SIGNAL_SNAPSHOT_QUEUE, FLOW_ACTION_SWEEP_QUEUE]),
    );
    expect(withFlow.repeatables).toContain(FLOW_ACTION_SWEEP_QUEUE);
    await running.close();
  });

  it('hands each job to the snapshot with the deps the inquiry-signals processor receives', async () => {
    const process = vi.fn<ProcessFlowSignalSnapshot>(() =>
      Promise.resolve({ outcome: 'written' as const, written: 2 }),
    );
    const networkSnapshots = createInMemoryNetworkSnapshots();
    const blindIndexKey = new Uint8Array(32).fill(9);
    const { options, workers } = harness({
      flow: { signalSnapshots: recordingSnapshots(), processSignalSnapshot: process },
      networkSnapshots,
      blindIndexKey,
    });
    const running = startWorkers(options);
    const result = await workers
      .find((worker) => worker.name === FLOW_SIGNAL_SNAPSHOT_QUEUE)
      ?.processor({ id: `${job.inquiryId}-3`, data: job });
    expect(result).toEqual({ outcome: 'written', written: 2 });
    const [data, deps] = process.mock.calls[0] ?? [];
    expect(data).toEqual(job);
    expect(deps).toMatchObject({
      db: options.db,
      keyring: options.keyring,
      blindIndexKey,
      networkSnapshots,
      logger: options.logger,
      clock: options.clock,
    });
    expect(deps).toHaveProperty('events');
    await running.close();
  });
});

describe('flowSignalSnapshotProcessor and its stub (C150.9)', () => {
  const deps = {
    db: {} as Db,
    clock: fixedClock(),
    logger: createCapturingLogger(),
    events: { stage: unused, dispatch: () => Promise.resolve() } as never,
    keyring: createKeyring(randomBytes(32)),
  };

  it('turns a permanent failure into UnrecoverableError (the job: jobs/flow/signal-snapshot.test.ts)', async () => {
    const processor = flowSignalSnapshotProcessor({
      ...deps,
      process: () => Promise.reject(new PermanentJobError(FLOW_SIGNAL_SNAPSHOT_NOT_BUILT)),
    });
    const processed = await processor({ id: 'x', data: job }).catch((thrown: unknown) => thrown);
    expect(processed).toBeInstanceOf(UnrecoverableError);
  });

  it('lets a passing failure be retried', async () => {
    const processor = flowSignalSnapshotProcessor({
      ...deps,
      process: () => Promise.reject(new Error('connection reset')),
    });
    const error = await processor({ id: 'x', data: job }).catch((thrown: unknown) => thrown);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });
});

describe('the flow-action-sweep (C152.2, C150.9)', () => {
  it('runs every 15 s, and only with the flow (its passes: jobs/repeatable/flow-actions.test.ts)', () => {
    const deps = { db: {} as Db, clock: fixedClock(), logger: createCapturingLogger() };
    expect(phase9RepeatableJobs(deps, false)).toEqual([]);
    const [sweep, ...rest] = phase9RepeatableJobs(deps, true);
    expect(rest).toEqual([]);
    expect(sweep?.name).toBe(FLOW_ACTION_SWEEP_QUEUE);
    expect(sweep?.repeat).toEqual({ every: FLOW_ACTION_SWEEP_INTERVAL_MS });
    expect(FLOW_ACTION_SWEEP_INTERVAL_MS).toBe(15_000);
  });
});

describe('the flow-action-sweep hands its events to the worker’s publisher (C152.2)', () => {
  it('passes the event publisher and the workflow step producer to each pass', async () => {
    const deps = { db: {} as Db, clock: fixedClock(), logger: createCapturingLogger() };
    const events = { stage: vi.fn(), dispatch: vi.fn() } as unknown as TransactionalEventPublisher;
    const workflowSteps = { add: vi.fn() } as unknown as WorkflowStepQueue;
    const seen: unknown[] = [];
    const [sweep] = phase9RepeatableJobs(deps, { events, workflowSteps }, (passDeps) => {
      seen.push(passDeps);
      return Promise.resolve({ settled: 0, canceled: 0, waitsEnded: 0, failed: 0 });
    });
    await sweep?.run();
    expect(seen).toEqual([expect.objectContaining({ events, workflowSteps })]);
  });
});

describe('the flow-signal-snapshot producer (C150.9)', () => {
  it('adds one job per branch entry, removed when it ends', async () => {
    const queue = createRecordingQueue<FlowSignalSnapshotJob>();
    await requestSignalSnapshot(createFlowSignalSnapshotQueue({ queue }), job);
    expect(queue.jobs).toEqual([
      {
        name: FLOW_SIGNAL_SNAPSHOT_QUEUE,
        data: job,
        options: { ...FLOW_SIGNAL_SNAPSHOT_JOB_OPTIONS, jobId: `${job.inquiryId}-3` },
      },
    ]);
  });

  it.each([
    ['an environment id', { ...job, environmentId: 'org_1' }],
    ['an inquiry id', { ...job, inquiryId: 'inq_bad' }],
    ['a step record', { ...job, stepRecordSeq: 0 }],
  ])('refuses a job without %s', async (_label, bad) => {
    const queue = createRecordingQueue<FlowSignalSnapshotJob>();
    await expect(
      createFlowSignalSnapshotQueue({ queue }).enqueueFlowSignalSnapshot(bad),
    ).rejects.toThrow(TypeError);
    expect(queue.jobs).toEqual([]);
  });
});
