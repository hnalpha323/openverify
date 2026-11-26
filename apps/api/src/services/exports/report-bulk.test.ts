/**
 * C166.5, C166.6 (Workflow 9B, `api-exports`; K13; contracts B21): bulk report creation through
 * `POST /reports/bulk`, `GET /reports/bulk/:id` and the `report-bulk` job.
 *
 * - The upload names an active template; its CSV's header names the type's query members and the
 *   optional links (each needing its scope, 403), at most 1,000 rows; any other column refuses the
 *   file (422, naming no cell). The CSV is stored sealed to the job and enqueued.
 * - The job creates each row's report with `origin: bulk`, records each row created (its report) or
 *   failed (a code, never skipped: 7B's `report_lists_required` on a custom-list template naming no
 *   list), skips a row already recorded (a retried job never creates a report twice), ends the job
 *   and deletes the CSV.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { reportConfigDefaultValues } from '@openverify/core';
import { recordReportBulkRow } from '@openverify/db';
import { seedReportTemplate } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReportBulkQueue } from '../../jobs/export-queues.js';
import { processReportBulk, type ReportBulkJobDeps } from '../../jobs/reports/report-bulk.js';
import { createCapturingLogger, createRecordingQueue } from '../../jobs/testing.js';
import type { ReportBulkJob, ReportRunJob } from '../../ports.js';
import { bearer, createTestApi, multipart, type TestApi } from '../../test-support/harness.js';

const bulkJobs = createRecordingQueue<ReportBulkJob>();
const runs: ReportRunJob[] = [];
let api: TestApi;
let watchlist: string;

beforeAll(async () => {
  api = await createTestApi({ reportBulk: createReportBulkQueue({ queue: bulkJobs }) });
  watchlist = (
    await seedReportTemplate(api.database.db, api.environmentId, {
      config: { ...reportConfigDefaultValues('watchlist'), 'search-lists': ['ofac-sdn'] },
    })
  ).templateId;
}, 120_000);

afterAll(async () => {
  await api.close();
});

const jobDeps = (): ReportBulkJobDeps => ({
  db: api.database.db,
  storage: api.storage,
  keyring: api.database.keyring,
  blindIndexKey: api.deps.blindIndexKey,
  events: api.events,
  clock: api.clock,
  logger: createCapturingLogger(),
  reports: {
    limits: api.deps.reportLimits,
    runs: {
      enqueueReportRun: (job) => {
        runs.push(job);
        return Promise.resolve();
      },
    },
  },
});

interface Job {
  id: string;
  attributes: {
    status: string;
    'row-count': number | null;
    'created-count': number;
    'failed-count': number;
    rows: {
      row: number;
      outcome: string;
      'report-id': string | null;
      'error-code': string | null;
    }[];
    'error-code': string | null;
  };
}

async function upload(csv: string, templateId = watchlist, token = api.token) {
  const form = await multipart({
    'report-template-id': templateId,
    file: { bytes: Buffer.from(csv), filename: 'reports.csv', type: 'text/csv' },
  });
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/reports/bulk',
    headers: { ...bearer(token), ...form.headers },
    payload: form.payload,
  });
}

async function uploaded(csv: string, templateId = watchlist): Promise<Job> {
  const response = await upload(csv, templateId);
  expect(response.statusCode, response.body).toBe(202);
  return response.json<{ data: Job }>().data;
}

async function read(id: string, token = api.token): Promise<Job> {
  const response = await api.app.inject({
    url: `/api/v1/reports/bulk/${id}`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: Job }>().data;
}

const run = (id: string) =>
  processReportBulk({ environmentId: api.environmentId, reportBulkJobId: id }, jobDeps());

describe('POST /reports/bulk (C166.5)', () => {
  it('stores the CSV sealed to a pending job and enqueues it', async () => {
    const job = await uploaded('name-first,name-last\nAvery,Synthetic\n');

    expect(job.attributes).toMatchObject({ status: 'pending', 'row-count': 1, rows: [] });
    expect(bulkJobs.jobs.map((each) => each.data.reportBulkJobId)).toContain(job.id);
    const stored = await api.database.db.execute(
      sql`select storage_key from report_bulk_jobs where id = ${job.id}`,
    );
    const key = (stored as unknown as { rows: { storage_key: string }[] }).rows[0]?.storage_key;
    const ciphertext = await api.storage.get(key ?? '');
    expect(Buffer.from(ciphertext ?? new Uint8Array()).toString('utf8')).not.toContain('Avery');
  });

  it('refuses a column the type does not take (422, naming no cell) and an unknown template (422)', async () => {
    const column = await upload('name-first,colour\nAvery,synthetic-blue\n');
    const template = await upload('name-first\nAvery\n', newId('rptp'));

    expect(column.statusCode).toBe(422);
    expect(column.body).not.toContain('synthetic-blue');
    expect(template.statusCode).toBe(422);
    expect(template.json<{ code: string }>().code).toBe('report_template_not_published');
  });

  it("needs each link's scope: inquiry-id needs inquiries:write (403)", async () => {
    const key = await api.newApiKey(api.environmentId, { scopes: ['reports:write'] });

    const response = await upload(`name-first,inquiry-id\nAvery,${newId('inq')}\n`, watchlist, key);

    expect(response.statusCode).toBe(403);
  });

  it('answers 404 for a job of another environment', async () => {
    const job = await uploaded('name-first,name-last\nAvery,Synthetic\n');
    const other = await api.newTenant();

    const response = await api.app.inject({
      url: `/api/v1/reports/bulk/${job.id}`,
      headers: bearer(other.token),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('the report-bulk job (C166.5, C166.6)', () => {
  it('creates each row’s report with origin bulk, records a failed row with its code, and deletes the CSV', async () => {
    const job = await uploaded(
      'name-first,name-last,birthdate\nAvery,Synthetic,\n,,1990-01-01\nRowan,Example,\n',
    );

    await run(job.id);
    const done = await read(job.id);

    expect(done.attributes).toMatchObject({
      status: 'completed',
      'created-count': 2,
      'failed-count': 1,
      'error-code': null,
    });
    expect(done.attributes.rows.map((row) => [row.row, row.outcome, row['error-code']])).toEqual([
      [1, 'created', null],
      [2, 'failed', 'report_query_invalid'],
      [3, 'created', null],
    ]);
    const reportIds = done.attributes.rows.flatMap((row) =>
      row['report-id'] === null ? [] : [row['report-id']],
    );
    const origins = await api.database.db.execute(
      sql`select distinct origin from reports where id in (${sql.join(
        reportIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
    expect((origins as unknown as { rows: { origin: string }[] }).rows).toEqual([
      { origin: 'bulk' },
    ]);
    expect(runs.map((each) => each.reportId)).toEqual(expect.arrayContaining(reportIds));
    const stored = await api.database.db.execute(
      sql`select storage_key from report_bulk_jobs where id = ${job.id}`,
    );
    expect((stored as unknown as { rows: { storage_key: string | null }[] }).rows[0]).toEqual({
      storage_key: null,
    });
  });

  it("records 7B's report_lists_required for each row of a custom-list template naming no list", async () => {
    const template = (
      await seedReportTemplate(api.database.db, api.environmentId, {
        reportType: 'custom-list',
        config: reportConfigDefaultValues('custom-list'),
      })
    ).templateId;
    const job = await uploaded('name-first\nAvery\n', template);

    await run(job.id);

    expect((await read(job.id)).attributes.rows).toEqual([
      { row: 1, outcome: 'failed', 'report-id': null, 'error-code': 'report_lists_required' },
    ]);
  });

  it('skips a row already recorded, so a retried job never creates its report twice', async () => {
    const job = await uploaded('name-first,name-last\nAvery,Synthetic\nRowan,Example\n');
    const earlier = newId('rep');
    await recordReportBulkRow(api.database.db, api.environmentId, job.id, {
      rowNumber: 1,
      outcome: 'created',
      reportId: earlier,
    });

    await run(job.id);
    const rows = (await read(job.id)).attributes.rows;

    expect(rows.map((row) => row.row)).toEqual([1, 2]);
    expect(rows[0]?.['report-id']).toBe(earlier);
    expect(rows[1]?.outcome).toBe('created');
  });
});
