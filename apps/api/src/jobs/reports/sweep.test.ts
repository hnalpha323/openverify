/**
 * C74.3 (Workflow 6A Stage 3, `api-reports`): the report sweep, on a frozen clock: (a) claimable
 * runs enqueued once per five minutes, a failed enqueue cleared for the next sweep; (b) one
 * catch-up run per due recurring report, its next run moved to the first boundary after now, never
 * a second while one is open, none for a paused or redacted report; (c) the re-screen recovery.
 * Synthetic values only.
 */
import { createReport, getReport, listReportRuns } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRecordingReportRescreenQueue,
  createRecordingReportRunQueue,
  fixedClock,
} from '../../test-support/fakes.js';
import { createWorkerLogger } from '../logger.js';
import { createReportSweep, type ReportSweepDeps } from './sweep.js';

let database: TestDatabase;
let environmentId: string;
const DAY = 86_400_000;

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function recurringReport(createdAt: Date, interval: number | null) {
  const { templateId, versionId } = await seedReportTemplate(database.db, environmentId, {
    config: { 'search-lists': ['openverify-sandbox'] },
  });
  const report = await createReport(database.db, environmentId, {
    id: testId('rep'),
    reportType: 'watchlist',
    reportTemplateId: templateId,
    reportTemplateVersionId: versionId,
    origin: 'api',
    query: { term: 'Synthetic Person' },
    querySources: {},
    inquiryId: null,
    accountId: null,
    recurrenceIntervalDays: interval,
    nextRunAt: interval === null ? null : new Date(createdAt.getTime() + interval * DAY),
    createdAt,
    initialRun: { id: testId('rpr'), scheduledFor: createdAt },
  });
  // The initial run completed.
  await database.client.query(
    `update report_runs set status = 'ready', completed_at = $2 where report_id = $1`,
    [report.id, createdAt.toISOString()],
  );
  return report.id;
}

function sweepDeps(now: Date, overrides: Partial<ReportSweepDeps> = {}) {
  const runs = createRecordingReportRunQueue();
  const rescreens = createRecordingReportRescreenQueue();
  const deps: ReportSweepDeps = {
    db: database.db,
    clock: fixedClock(now),
    logger: createWorkerLogger({ level: 'silent' }),
    runs,
    rescreens,
    limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
    ...overrides,
  };
  return { deps, runs, rescreens };
}

const recover = () => Promise.resolve({ enqueued: 2, failed: 0 });

describe('the report sweep (C74.3)', () => {
  it('inserts one catch-up run after several missed intervals and moves the next run past now (F06)', async () => {
    const start = new Date('2026-09-01T00:00:00.000Z');
    const id = await recurringReport(start, 1);
    const now = new Date(start.getTime() + 5.5 * DAY);
    const sweep = createReportSweep({ recover });
    const { deps, runs } = sweepDeps(now);
    const first = await sweep(deps);
    expect(first.scheduled).toBeGreaterThanOrEqual(1);
    const created = await listReportRuns(database.db, environmentId, id);
    expect(created.filter((run) => run.runType === 'scheduled')).toHaveLength(1);
    expect((await getReport(database.db, environmentId, id))?.nextRunAt).toEqual(
      new Date(start.getTime() + 6 * DAY),
    );
    expect(runs.jobs.map((job) => job.reportId)).toContain(id);
    const second = sweepDeps(new Date(now.getTime() + 60_000));
    await sweep(second.deps);
    expect(
      (await listReportRuns(database.db, environmentId, id)).filter(
        (run) => run.runType === 'scheduled',
      ),
    ).toHaveLength(1);
    // Enqueued at most once every five minutes.
    expect(second.runs.jobs.map((job) => job.reportId)).not.toContain(id);
    const later = sweepDeps(new Date(now.getTime() + 6 * 60_000));
    await sweep(later.deps);
    expect(later.runs.jobs.map((job) => job.reportId)).toContain(id);
  });

  it('skips a due report that already has an open scheduled run, a paused and a redacted one', async () => {
    const start = new Date('2026-09-10T00:00:00.000Z');
    const paused = await recurringReport(start, 1);
    const redacted = await recurringReport(start, 1);
    await database.client.query(
      `update reports set paused_at = $2, paused_reason = 'operator' where id = $1`,
      [paused, start.toISOString()],
    );
    await database.client.query(`update reports set redacted_at = $2 where id = $1`, [
      redacted,
      start.toISOString(),
    ]);
    const { deps } = sweepDeps(new Date(start.getTime() + 2 * DAY));
    await createReportSweep({ recover })(deps);
    for (const id of [paused, redacted]) {
      expect(
        (await listReportRuns(database.db, environmentId, id)).filter(
          (run) => run.runType === 'scheduled',
        ),
      ).toEqual([]);
    }
  });

  it('clears the stamp of a run whose enqueue failed, so the next sweep enqueues it (C74.1)', async () => {
    const start = new Date('2026-09-20T00:00:00.000Z');
    const id = await recurringReport(start, 1);
    const now = new Date(start.getTime() + 1.2 * DAY);
    const failing = sweepDeps(now);
    failing.runs.failNext(new Error('synthetic valkey outage'));
    const sweep = createReportSweep({ recover, batchSize: 1, maxBatches: 50 });
    const outcome = await sweep(failing.deps);
    expect(outcome.failed).toBeGreaterThanOrEqual(1);
    const retry = sweepDeps(new Date(now.getTime() + 15_000));
    await sweep(retry.deps);
    const scheduled = (await listReportRuns(database.db, environmentId, id)).find(
      (run) => run.runType === 'scheduled',
    );
    expect(
      [...failing.runs.jobs, ...retry.runs.jobs].filter((job) => job.runId === scheduled?.id),
    ).toHaveLength(1);
  });

  it('enqueues pending re-screens through the recovery (c)', async () => {
    const { deps } = sweepDeps(new Date('2026-10-01T00:00:00.000Z'));
    const outcome = await createReportSweep({ recover })(deps);
    expect(outcome.rescreens).toBe(2);
  });

  it('enqueues a pending run of a one-off report once', async () => {
    const { templateId, versionId } = await seedReportTemplate(database.db, environmentId, {
      config: { 'search-lists': ['openverify-sandbox'] },
    });
    const at = new Date('2026-10-02T00:00:00.000Z');
    const runId = testId('rpr');
    await createReport(database.db, environmentId, {
      id: testId('rep'),
      reportType: 'watchlist',
      reportTemplateId: templateId,
      reportTemplateVersionId: versionId,
      origin: 'inquiry_completion',
      query: { term: 'Synthetic Person' },
      querySources: {},
      inquiryId: null,
      accountId: null,
      recurrenceIntervalDays: null,
      nextRunAt: null,
      createdAt: at,
      initialRun: { id: runId, scheduledFor: at },
    });
    const { deps, runs } = sweepDeps(new Date(at.getTime() + 10_000));
    await createReportSweep({ recover })(deps);
    expect(runs.jobs.filter((job) => job.runId === runId)).toHaveLength(1);
  });
});
