/**
 * C173.1 (Workflow 9B, `api-cases-reports`; K15, contracts B38): the report resource serves
 * `latest-run-notes`, the note codes of the report's latest finished run (Phase 6 C74: a run that
 * completed, `ready` or `errored`), newest by its creation. A run still pending or running has not
 * written its notes, so it never hides the latest finished one; a report no run has finished leaves
 * the member out rather than answering an empty list. Codes only: never a value.
 *
 * Every value is synthetic.
 */
import type { Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedReport,
  seedReportRun,
  seedReportTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { findStoredReport, reportResourceOf } from './reports.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let template: { templateId: string; versionId: string };

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
  template = await seedReportTemplate(db, environmentId, {
    config: { 'search-lists': ['openverify-sandbox'] },
  });
}, 60_000);

afterAll(async () => {
  await database.close();
});

const T0 = Date.parse('2026-10-01T00:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

async function run(
  reportId: string,
  options: { status: 'pending' | 'ready' | 'errored'; minute: number; notes: string[] },
) {
  const id = await seedReportRun(db, environmentId, { reportId, status: options.status });
  await db.execute(sql`update report_runs set created_at = ${at(options.minute)},
    completed_at = ${options.status === 'pending' ? null : at(options.minute + 1)},
    notes = ${`{${options.notes.join(',')}}`}::text[] where id = ${id}`);
  return id;
}

async function attributesOf(reportId: string) {
  const report = await findStoredReport(db, environmentId, reportId);
  return (await reportResourceOf(db, report, UNMASKED)).attributes as Record<string, unknown>;
}

const report = () => seedReport(db, environmentId, { ...template, status: 'ready' });

describe('latest-run-notes (C173.1)', () => {
  it('serves the notes of the latest finished run, never those of an older one or a pending one', async () => {
    const id = await report();
    await run(id, { status: 'ready', minute: 0, notes: ['inquiry_already_decided'] });
    await run(id, { status: 'errored', minute: 10, notes: ['report_errored', 'recurring_limit'] });
    await run(id, { status: 'pending', minute: 20, notes: [] });

    expect((await attributesOf(id))['latest-run-notes']).toEqual([
      'report_errored',
      'recurring_limit',
    ]);
  });

  it('serves an empty list for a finished run that wrote no note', async () => {
    const id = await report();
    await run(id, { status: 'ready', minute: 0, notes: [] });

    expect((await attributesOf(id))['latest-run-notes']).toEqual([]);
  });

  it('leaves the member out while no run has finished', async () => {
    const id = await report();
    await run(id, { status: 'pending', minute: 0, notes: [] });

    expect(await attributesOf(id)).not.toHaveProperty('latest-run-notes');
  });
});
