/**
 * C74.1, C74.4, C85.4 (V02, V05): the report queues. A run's job id is its run id and a
 * re-screen's `rescreen-<sync id>`; both carry ids only, and both remove their jobs when they
 * complete or fail, because the database rows are the record and a kept job id would make every
 * later add a no-op. Built from a connection, a producer opens its queue only on first use.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReportRescreenJob, ReportRunJob } from '../ports.js';
import { createRecordingQueue } from './testing.js';
import {
  REPORT_RESCREEN_JOB,
  REPORT_RESCREEN_JOB_OPTIONS,
  REPORT_RESCREEN_QUEUE,
  REPORT_RUN_JOB,
  REPORT_RUN_JOB_OPTIONS,
  REPORT_RUN_QUEUE,
  REPORT_SWEEP_INTERVAL_MS,
  REPORT_SWEEP_QUEUE,
  WATCHLISTS_REFRESH_INTERVAL_MS,
  WATCHLISTS_REFRESH_QUEUE,
  createReportRescreenQueue,
  createReportRunQueue,
  reportRescreenJobId,
} from './report-queues.js';

const bull = vi.hoisted(() => ({ created: [] as string[] }));
vi.mock('./queue.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./queue.js')>();
  return {
    ...original,
    createBullQueue: (name: string) => {
      bull.created.push(name);
      return {
        add: () => Promise.resolve(),
        close: () => Promise.resolve(),
      };
    },
  };
});

const run: ReportRunJob = {
  environmentId: 'env_01M5CJXHG0000000000000000A',
  reportId: 'rep_01M5CK16P0D13FXHZSS4TCFBVH',
  runId: 'rpr_01M5CK16P0D13FXHZSS4TCFBVJ',
};

describe('the report queue names and schedules (C85.4)', () => {
  it('are their own, and the repeatable ones run every 15 seconds and 15 minutes', () => {
    expect([REPORT_RUN_QUEUE, REPORT_RUN_JOB]).toEqual(['report-run', 'report-run']);
    expect([REPORT_RESCREEN_QUEUE, REPORT_RESCREEN_JOB]).toEqual([
      'report-rescreen',
      'report-rescreen',
    ]);
    expect([REPORT_SWEEP_QUEUE, REPORT_SWEEP_INTERVAL_MS]).toEqual(['report-sweep', 15_000]);
    expect([WATCHLISTS_REFRESH_QUEUE, WATCHLISTS_REFRESH_INTERVAL_MS]).toEqual([
      'watchlists-refresh',
      900_000,
    ]);
  });
});

describe('createReportRunQueue (C74.1)', () => {
  it('removes finished jobs, and retries five times with backoff and jitter', () => {
    expect(REPORT_RUN_JOB_OPTIONS).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000, jitter: 0.5 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('enqueues one job per run under the run id, with the ids only', async () => {
    const queue = createRecordingQueue<ReportRunJob>();
    await createReportRunQueue({ queue }).enqueueReportRun({
      ...run,
      query: 'never enqueued',
    } as ReportRunJob);

    expect(queue.jobs).toEqual([
      { name: 'report-run', data: run, options: { ...REPORT_RUN_JOB_OPTIONS, jobId: run.runId } },
    ]);
  });

  it.each([
    ['a malformed environment id', { ...run, environmentId: 'env:1' }],
    ['a report id of another kind', { ...run, reportId: 'inq_01M5CK16P0D13FXHZSS4TCFBVH' }],
    ['a malformed run id', { ...run, runId: 'rpr_nope' }],
  ])('refuses %s', async (_label, job) => {
    const queue = createRecordingQueue<ReportRunJob>();

    await expect(createReportRunQueue({ queue }).enqueueReportRun(job)).rejects.toThrow(TypeError);
    expect(queue.jobs).toEqual([]);
  });

  it('propagates a queue failure to the caller and closes its queue', async () => {
    const queue = createRecordingQueue<ReportRunJob>();
    queue.fail = new Error('connection is closed');
    const producer = createReportRunQueue({ queue });

    await expect(producer.enqueueReportRun(run)).rejects.toThrow('connection is closed');
    await producer.close();
    expect(queue.closed).toBe(true);
  });
});

describe('createReportRescreenQueue (C74.4)', () => {
  it('removes finished jobs, and retries three times with backoff', () => {
    expect(REPORT_RESCREEN_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000, jitter: 0.5 },
      removeOnComplete: true,
      removeOnFail: true,
    });
    expect(reportRescreenJobId(42)).toBe('rescreen-42');
  });

  it('enqueues one job per sync under rescreen-<sync id>, which holds no colon', async () => {
    const queue = createRecordingQueue<ReportRescreenJob>();
    await createReportRescreenQueue({ queue }).enqueueReportRescreen({
      syncId: 7,
      source: 'never enqueued',
    } as ReportRescreenJob);

    expect(queue.jobs).toEqual([
      {
        name: 'report-rescreen',
        data: { syncId: 7 },
        options: { ...REPORT_RESCREEN_JOB_OPTIONS, jobId: 'rescreen-7' },
      },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'refuses the sync id %s',
    async (syncId) => {
      const queue = createRecordingQueue<ReportRescreenJob>();

      await expect(
        createReportRescreenQueue({ queue }).enqueueReportRescreen({ syncId }),
      ).rejects.toThrow(TypeError);
      expect(queue.jobs).toEqual([]);
    },
  );
});

describe('a report producer built from a connection', () => {
  it('opens its queue on the first enqueue only, once, and closes nothing it never opened', async () => {
    bull.created.length = 0;
    const runs = createReportRunQueue({ connection: { url: 'redis://127.0.0.1:1' } });
    const rescreens = createReportRescreenQueue({ connection: { url: 'redis://127.0.0.1:1' } });
    expect(bull.created).toEqual([]);

    await runs.enqueueReportRun(run);
    await runs.enqueueReportRun({ ...run, runId: 'rpr_01M5CK16P0D13FXHZSS4TCFBVK' });
    await rescreens.close();

    expect(bull.created).toEqual(['report-run']);
    await runs.close();
  });
});
