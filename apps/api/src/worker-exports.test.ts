/**
 * Workflow 9B Stage 1b, checkpoint (X): the export and bulk report jobs in the worker (C166.1,
 * C166.5, C174.3): the `export` and `report-bulk` workers and `export-sweep` (every 60 seconds) start
 * only with `StartWorkersOptions.exports`; each job is handed its ids and the worker's deps, a
 * permanent failure becomes BullMQ's UnrecoverableError, and the sweep holds both producers; the
 * frozen producers name each job by its row's id; the stubs of `api-exports` fail permanently,
 * saying so, until built.
 */
import { newId } from '@openverify/contracts';
import { createKeyring, type Db } from '@openverify/db';
import { createTestDatabase } from '@openverify/db/testing';
import { UnrecoverableError, type WorkerOptions } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PermanentJobError } from './jobs/errors.js';
import {
  createExportQueue,
  createReportBulkQueue,
  EXPORT_QUEUE,
  EXPORT_SWEEP_INTERVAL_MS,
  EXPORT_SWEEP_QUEUE,
  REPORT_BULK_QUEUE,
} from './jobs/export-queues.js';
import { processExport, type ProcessExport } from './jobs/exports/export.js';
import { runExportSweep, type RunExportSweep } from './jobs/exports/sweep.js';
import { processReportBulk, type ProcessReportBulk } from './jobs/reports/report-bulk.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  createRecordingQueue,
} from './jobs/testing.js';
import type {
  ExportJob,
  ExportQueue,
  ReportBulkJob,
  ReportBulkQueue,
  VisionClient,
} from './ports.js';
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

const ENV = newId('env');
const EXP = newId('exp');
const RBULK = newId('rbulk');

const producers = () => ({
  exports: { enqueueExport: vi.fn<ExportQueue['enqueueExport']>(() => Promise.resolve()) },
  reportBulk: {
    enqueueReportBulk: vi.fn<ReportBulkQueue['enqueueReportBulk']>(() => Promise.resolve()),
  },
});

describe('startWorkers: export, report-bulk and export-sweep (C166.1, C166.5, C174.3)', () => {
  it('start only with the export options, the sweep every 60 seconds', async () => {
    const without = harness();
    await startWorkers(without.options).close();
    expect(without.workers.map((worker) => worker.name)).not.toEqual(
      expect.arrayContaining([EXPORT_QUEUE]),
    );
    expect(without.workers.map((worker) => worker.name)).not.toContain(REPORT_BULK_QUEUE);
    expect([...without.schedules.keys()]).not.toContain(EXPORT_SWEEP_QUEUE);

    const withExports = harness({ exports: { ...producers(), runSweep: vi.fn<RunExportSweep>() } });
    const running = startWorkers(withExports.options);
    expect(withExports.workers.map((worker) => worker.name)).toEqual(
      expect.arrayContaining([EXPORT_QUEUE, REPORT_BULK_QUEUE]),
    );
    expect(EXPORT_SWEEP_INTERVAL_MS).toBe(60_000);
    expect(withExports.schedules.get(EXPORT_SWEEP_QUEUE)).toEqual({
      every: EXPORT_SWEEP_INTERVAL_MS,
    });
    await running.close();
  });

  it('hand each job its ids and the worker’s deps, and make a permanent failure unrecoverable', async () => {
    const processExportJob = vi.fn<ProcessExport>(() => Promise.resolve());
    const processBulkJob = vi.fn<ProcessReportBulk>(() =>
      Promise.reject(new PermanentJobError('report_template_missing')),
    );
    const { options, workers } = harness({
      exports: {
        ...producers(),
        processExport: processExportJob,
        processReportBulk: processBulkJob,
      },
    });
    const running = startWorkers(options);

    await workers
      .find((worker) => worker.name === EXPORT_QUEUE)
      ?.processor({ id: '1', data: { environmentId: ENV, exportId: EXP } });
    const failed = await workers
      .find((worker) => worker.name === REPORT_BULK_QUEUE)
      ?.processor({ id: '2', data: { environmentId: ENV, reportBulkJobId: RBULK } })
      .catch((thrown: unknown) => thrown);

    expect(processExportJob).toHaveBeenCalledTimes(1);
    expect(processExportJob.mock.calls[0]?.[0]).toEqual({ environmentId: ENV, exportId: EXP });
    expect(processExportJob.mock.calls[0]?.[1]).toMatchObject({
      db: options.db,
      storage: options.storage,
      keyring: options.keyring,
      clock: options.clock,
      logger: options.logger,
    });
    expect(processBulkJob.mock.calls[0]?.[0]).toEqual({
      environmentId: ENV,
      reportBulkJobId: RBULK,
    });
    expect(failed).toBeInstanceOf(UnrecoverableError);
    await running.close();
  });

  it('hands each sweep the database, storage, clock and logger with both producers', async () => {
    const runSweep = vi.fn<RunExportSweep>(() =>
      Promise.resolve({
        expiredExports: 1,
        deletedReportBulkFiles: 0,
        requeued: 0,
        failedDeletes: 0,
      }),
    );
    const queues = producers();
    const { options, workers } = harness({ exports: { ...queues, runSweep } });
    const running = startWorkers(options);

    await workers
      .find((worker) => worker.name === EXPORT_SWEEP_QUEUE)
      ?.processor({ id: '1', data: { name: EXPORT_SWEEP_QUEUE } });

    expect(runSweep).toHaveBeenCalledTimes(1);
    expect(runSweep.mock.calls[0]?.[0]).toEqual({
      db: options.db,
      storage: options.storage,
      clock: options.clock,
      logger: options.logger,
      exports: queues.exports,
      reportBulk: queues.reportBulk,
    });
    await running.close();
  });
});

describe('the frozen producers (jobs/export-queues.ts)', () => {
  it('name each job by its row’s id, removed on completion and failure, and refuse other ids', async () => {
    const exportQueue = createRecordingQueue<ExportJob>();
    const bulkQueue = createRecordingQueue<ReportBulkJob>();
    const exports = createExportQueue({ queue: exportQueue });
    const bulk = createReportBulkQueue({ queue: bulkQueue });

    await exports.enqueueExport({ environmentId: ENV, exportId: EXP });
    await bulk.enqueueReportBulk({ environmentId: ENV, reportBulkJobId: RBULK });

    expect(exportQueue.jobs).toEqual([
      expect.objectContaining({
        name: EXPORT_QUEUE,
        data: { environmentId: ENV, exportId: EXP },
        options: expect.objectContaining({
          jobId: EXP,
          removeOnComplete: true,
          removeOnFail: true,
        }) as unknown,
      }),
    ]);
    expect(bulkQueue.jobs[0]).toMatchObject({ name: REPORT_BULK_QUEUE, options: { jobId: RBULK } });
    await expect(exports.enqueueExport({ environmentId: ENV, exportId: RBULK })).rejects.toThrow(
      TypeError,
    );
    await expect(
      bulk.enqueueReportBulk({ environmentId: 'inq_x', reportBulkJobId: RBULK }),
    ).rejects.toThrow(TypeError);
  });
});

describe('the export jobs (api-exports)', () => {
  it('run the export and report-bulk jobs and the sweep once built (api-exports)', async () => {
    const database = await createTestDatabase();
    try {
      const logger = createCapturingLogger();
      const deps = {
        db: database.db,
        storage: createMemoryStorage(),
        keyring: createKeyring(randomBytes(32)),
        events: undefined as never,
        clock: fixedClock(),
        logger,
      };

      await expect(
        processExport({ environmentId: ENV, exportId: EXP }, deps),
      ).resolves.toBeUndefined();
      const swept = await runExportSweep({ ...deps, ...producers() });
      await expect(
        processReportBulk({ environmentId: ENV, reportBulkJobId: RBULK }, deps),
      ).resolves.toBeUndefined();
      expect(swept).toEqual({
        expiredExports: 0,
        deletedReportBulkFiles: 0,
        requeued: 0,
        failedDeletes: 0,
      });
      expect(logger.entries.map((entry) => entry.message)).not.toContain(
        'export sweep not built yet',
      );
    } finally {
      await database.close();
    }
  }, 120_000);
});
