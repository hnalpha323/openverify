/**
 * The daily `retention` job (C16), on BullMQ over the Redis protocol (Valkey). A job scheduler
 * (`upsertJobScheduler`, keyed `retention-daily`) adds one `retention` job every day at 03:00
 * UTC; every worker process upserts the same scheduler, so there is still one job a day. The
 * worker runs one job at a time and each job is one idempotent retention run
 * (`runRetention`), so a retried or overlapping run does no harm.
 *
 * Redactions emit `inquiry.redacted` through the event publisher, whose webhook deliveries go
 * to the `webhook-delivery` queue like the other workers' events. Logs carry counts, ids and
 * error classes, never data.
 */
import type { Db } from '@openverify/db';
import { Queue, Worker, type ConnectionOptions, type WorkerOptions } from 'bullmq';
import { createEventPublisher } from '../events/index.js';
import { createListRescreenQueue, type ClosableListRescreenQueue } from './list-rescreen-queue.js';
import {
  createWorkflowTriggerQueue,
  createWorkflowWaitMatchQueue,
  type ClosableWorkflowTriggerQueue,
  type ClosableWorkflowWaitMatchQueue,
} from './workflow-queues.js';
import type { Clock, FileStorage, RedactionService } from '../ports.js';
import { createRedactionService } from '../services/redaction.js';
import {
  isRetentionIncomplete,
  RetentionIncompleteError,
  runRetention,
  type RetentionOptions,
  type RetentionReport,
} from '../services/retention.js';
import {
  createWebhookDeliveryScheduler,
  WEBHOOK_DELIVERY_QUEUE,
  type WebhookDeliveryJob,
} from '../webhooks/queue.js';
import type { WorkerLogger } from './logger.js';
import { createBullQueue, type JobQueue } from './queue.js';

export const RETENTION_QUEUE = 'retention';
export const RETENTION_JOB = 'retention';
export const RETENTION_SCHEDULER_ID = 'retention-daily';

/** When the job runs: a cron pattern (with its time zone) or a fixed interval in ms. */
export type RetentionSchedule = { pattern: string; tz?: string } | { every: number };

/** C16: daily, at 03:00 UTC. */
export const RETENTION_SCHEDULE: RetentionSchedule = Object.freeze({
  pattern: '0 3 * * *',
  tz: 'UTC',
});

/**
 * A failed run is retried three times, a minute apart and then longer; runs are idempotent.
 * Finished jobs are kept a week (failed ones a month) for inspection.
 */
export const RETENTION_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 7 * 86_400, count: 100 },
  removeOnFail: { age: 30 * 86_400 },
});

export interface RetentionJobTemplate {
  name: string;
  data: Record<string, never>;
  opts: typeof RETENTION_JOB_OPTIONS;
}

/** The part of a BullMQ `Queue` the scheduler uses. */
export interface RetentionQueue {
  upsertJobScheduler(
    id: string,
    repeat: RetentionSchedule,
    template: RetentionJobTemplate,
  ): Promise<unknown>;
  close(): Promise<void>;
}

/** The part of a BullMQ job the processor and the `failed` listener read. */
export interface RetentionJobRef {
  id?: string | undefined;
}

export type RetentionProcessor = (job: RetentionJobRef) => Promise<RetentionReport>;

/** The part of a BullMQ `Worker` the job uses, so tests can start a fake. */
export interface RetentionWorker {
  on(event: 'failed', listener: (job: RetentionJobRef | undefined, error: Error) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  close(): Promise<void>;
}

/** Creates (or updates) the daily job scheduler. */
export async function scheduleRetention(
  queue: RetentionQueue,
  schedule: RetentionSchedule = RETENTION_SCHEDULE,
): Promise<void> {
  await queue.upsertJobScheduler(RETENTION_SCHEDULER_ID, schedule, {
    name: RETENTION_JOB,
    data: {},
    opts: RETENTION_JOB_OPTIONS,
  });
}

/**
 * The `retention` processor: one retention run per job. A run that left PII behind fails the
 * job once it is done, so BullMQ records the failure and retries it (2B F031).
 */
export function retentionProcessor(options: RetentionOptions): RetentionProcessor {
  return async () => {
    const report = await runRetention(options);
    if (isRetentionIncomplete(report)) {
      throw new RetentionIncompleteError(report);
    }
    return report;
  };
}

interface QueueSettings {
  connection: ConnectionOptions;
  prefix?: string;
}

export interface StartRetentionJobOptions {
  connection: ConnectionOptions;
  /** Key prefix in Valkey, as the other workers use it. */
  prefix?: string | undefined;
  db: Db;
  storage: FileStorage;
  logger: WorkerLogger;
  clock?: Clock;
  /** Defaults to {@link RETENTION_SCHEDULE}. */
  schedule?: RetentionSchedule;
  /** Rows per batch; defaults to 500. */
  batchSize?: number;
  /** Replaces the redaction service built from the options. */
  redaction?: RedactionService;
  createQueue?: (name: string, settings: QueueSettings) => RetentionQueue;
  /** The `webhook-delivery` queue the redaction events are delivered through. */
  createDeliveryQueue?: (name: string, settings: QueueSettings) => JobQueue<WebhookDeliveryJob>;
  /** C118.1, C119.3 (F02): replace the engine's producers, for tests. */
  workflowTriggers?: ClosableWorkflowTriggerQueue | undefined;
  workflowWaitMatches?: ClosableWorkflowWaitMatchQueue | undefined;
  /** C127.12: the `list-rescreen` producer; the same. */
  listRescreens?: ClosableListRescreenQueue | undefined;
  createWorker?: (
    name: string,
    processor: RetentionProcessor,
    options: WorkerOptions,
  ) => RetentionWorker;
}

export interface RunningRetentionJob {
  /** Settles once the scheduler is upserted; a failure is logged, never thrown. */
  ready: Promise<void>;
  close(): Promise<void>;
}

/** Starts the `retention` worker and upserts its daily scheduler. */
export function startRetentionJob(options: StartRetentionJobOptions): RunningRetentionJob {
  const { connection, prefix, db, storage, logger } = options;
  const settings: QueueSettings = { connection, ...(prefix === undefined ? {} : { prefix }) };
  /* v8 ignore start -- the real BullMQ classes run in the Testcontainers test */
  const createQueue: NonNullable<StartRetentionJobOptions['createQueue']> =
    options.createQueue ??
    ((name: string, queueSettings: QueueSettings) => {
      const queue = new Queue(name, queueSettings);
      queue.on('error', (error) => {
        logger.error({ queue: name, error: error.name }, 'retention queue error');
      });
      return queue;
    });
  const createDeliveryQueue: NonNullable<StartRetentionJobOptions['createDeliveryQueue']> =
    options.createDeliveryQueue ??
    ((name: string, queueSettings: QueueSettings) =>
      createBullQueue<WebhookDeliveryJob>(name, queueSettings));
  const createWorker: NonNullable<StartRetentionJobOptions['createWorker']> =
    options.createWorker ??
    ((name: string, processor: RetentionProcessor, workerOptions: WorkerOptions) =>
      new Worker(name, processor, workerOptions));
  /* v8 ignore stop */

  const deliveries = createWebhookDeliveryScheduler(
    createDeliveryQueue(WEBHOOK_DELIVERY_QUEUE, settings),
  );
  // C118.1, C119.3 (F02): a redaction's events wake deliveries and waits like any other's.
  const workflowTriggers = options.workflowTriggers ?? createWorkflowTriggerQueue(settings);
  const workflowWaitMatches = options.workflowWaitMatches ?? createWorkflowWaitMatchQueue(settings);
  const listRescreens = options.listRescreens ?? createListRescreenQueue(settings);
  const redaction =
    options.redaction ??
    createRedactionService({
      db,
      storage,
      events: createEventPublisher({
        db,
        deliveries,
        logger,
        workflowTriggers,
        workflowSteps: workflowWaitMatches,
        listRescreens,
      }),
      logger,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
  const queue = createQueue(RETENTION_QUEUE, settings);
  const ready = scheduleRetention(queue, options.schedule).catch((error: unknown) => {
    logger.error(
      { queue: RETENTION_QUEUE, error: (error as Error).name },
      'retention job not scheduled',
    );
  });
  const worker = createWorker(
    RETENTION_QUEUE,
    retentionProcessor({
      db,
      storage,
      redaction,
      logger,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
    }),
    { ...settings, concurrency: 1 },
  );
  worker.on('failed', (job, error) => {
    logger.error(
      { queue: RETENTION_QUEUE, jobId: job?.id ?? null, error: error.name },
      'retention job failed',
    );
  });
  worker.on('error', (error) => {
    logger.error({ queue: RETENTION_QUEUE, error: error.name }, 'retention worker error');
  });

  return {
    ready,
    async close() {
      await worker.close();
      await Promise.all([
        queue.close(),
        deliveries.close(),
        workflowTriggers.close(),
        workflowWaitMatches.close(),
        listRescreens.close(),
      ]);
    },
  };
}
