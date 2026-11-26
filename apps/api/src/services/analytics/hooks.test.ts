/**
 * C163.2-C163.6 (Workflow 9B, `api-analytics`; verification round H04, review P20): the analytics
 * hooks `foundation-9b` placed, built:
 * - the redaction records the inquiry's contribution while its day is open, so that no count a
 *   reader sees (`facts` plus `redacted`) changes at the redaction, at the next 5-minute pass or at the
 *   next outcome refresh; a closed day is frozen and gets nothing; the current day keeps its live
 *   counts; an inquiry already redacted adds nothing;
 * - the C16 pass removes rollup rows past `analytics-retention-months` and the assignee rows past
 *   their own window;
 * - a reporting zone the database does not know is refused in the settings change;
 * - a deleted user's assignee rows are re-keyed to "former user".
 * Every value is synthetic.
 */
import {
  analyticsCaseAssigneeDaily,
  analyticsInquiryDaily,
  analyticsRollupTables,
  type Db,
} from '@openverify/db';
import { createTestDatabase, testId, type TestDatabase } from '@openverify/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnprocessableContentError } from '../../errors.js';
import { runAnalyticsRollup } from '../../jobs/analytics/rollup.js';
import { createCapturingLogger, createMemoryStorage } from '../../jobs/testing.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import { createRedactionService } from '../redaction.js';
import { forgetAnalyticsAssigneeInTx } from './assignees.js';
import { recordRedactedContributionInTx } from './redaction.js';
import { runAnalyticsRetention } from './retention.js';
import { onAnalyticsSettingsChangedInTx } from './settings-hook.js';
import {
  seedAnalyticsCaseTemplate,
  seedAnalyticsInquiry,
  seedAnalyticsSteps,
  seedAnalyticsTenant,
  seedAnalyticsUser,
  seedAnalyticsVerification,
  setAnalyticsSettings,
  type AnalyticsTenant,
} from './testing.js';

const ZONE = 'Europe/Paris';
const NOW = new Date('2026-04-10T10:00:00Z');
const HISTOGRAMS = new Set(['finishSecondsHistogram', 'resolutionSecondsHistogram']);

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 60_000);

afterAll(async () => {
  await database.close();
});

/**
 * Every count a reader adds (both sources) for one environment, by table and column; histograms by
 * bucket. Keys are not summed.
 */
async function readerTotals(environmentId: string): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const [name, table] of Object.entries(analyticsRollupTables)) {
    const rows = (await db
      .select()
      .from(table)
      .where(eq(table.environmentId, environmentId))) as Record<string, unknown>[];
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value === 'number') {
          totals[`${name}.${column}`] = (totals[`${name}.${column}`] ?? 0) + value;
        } else if (HISTOGRAMS.has(column) && Array.isArray(value)) {
          (value as number[]).forEach((count, index) => {
            const key = `${name}.${column}.${String(index)}`;
            totals[key] = (totals[key] ?? 0) + count;
          });
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(totals).filter(([, value]) => value !== 0));
}

/** A finished inquiry with a step record, an attempt and two checks, on `createdAt`. */
async function seedFinished(tenant: AnalyticsTenant, createdAt: Date) {
  const id = await seedAnalyticsInquiry(db, tenant, {
    createdAt,
    status: 'completed',
    finished: { as: 'completed', afterSeconds: 900 },
    platform: 'web',
    deviceKind: 'mobile-web',
    tags: ['synthetic'],
    flowOutcome: { verificationTypesOnPath: ['government-id'], fallbacksTaken: [], flags: [] },
  });
  await seedAnalyticsSteps(db, tenant, id, [
    { stepId: 'start', type: 'consent' },
    { stepId: 'document', type: 'government_id' },
    { stepId: 'done', type: 'completion' },
  ]);
  await seedAnalyticsVerification(db, tenant, id, {
    type: 'government_id',
    status: 'passed',
    country: 'FR',
    captureMethod: 'camera',
    checks: [
      { name: 'id_barcode_detection', status: 'passed' },
      { name: 'id_expiration_detection', status: 'not_applicable', reasons: ['execution_error'] },
    ],
  });
  return id;
}

describe('the redaction’s contribution (C163.4; verification round, H04)', () => {
  let tenant: AnalyticsTenant;
  const clock = fixedClock(NOW);
  const logger = createCapturingLogger();
  const pass = () => runAnalyticsRollup({ db, clock, logger });
  const redact = (inquiryId: string) =>
    createRedactionService({
      db,
      storage: createMemoryStorage(),
      events: createRecordingEventPublisher(),
      clock,
      audit: createRecordingAuditLogger(),
    }).redactInquiry(
      { environmentId: tenant.environmentId, organizationId: tenant.organizationId },
      inquiryId,
      null,
    );
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    tenant = await seedAnalyticsTenant(db);
    await setAnalyticsSettings(db, tenant.environmentId, { 'analytics-time-zone': ZONE });
    for (let index = 0; index < 3; index += 1) {
      ids[`open${String(index)}`] = await seedFinished(tenant, new Date('2026-04-07T09:00:00Z'));
    }
    ids.closed = await seedFinished(tenant, new Date('2026-02-20T09:00:00Z'));
    ids.pending = await seedAnalyticsInquiry(db, tenant, {
      createdAt: new Date('2026-04-07T11:00:00Z'),
      status: 'pending',
    });
    ids.today = await seedAnalyticsInquiry(db, tenant, {
      createdAt: new Date('2026-04-10T08:00:00Z'),
      status: 'pending',
    });
    await pass();
  });

  it('leaves every count unchanged on an open day: at the redaction, the next pass and the next outcome refresh', async () => {
    const before = await readerTotals(tenant.environmentId);
    await redact(ids.open0 ?? '');
    expect(await readerTotals(tenant.environmentId)).toEqual(before);

    clock.set(new Date(NOW.getTime() + 5 * 60_000));
    await pass();
    expect(await readerTotals(tenant.environmentId)).toEqual(before);

    clock.set(new Date('2026-04-11T00:10:00Z'));
    await pass();
    // The current day of the first passes is stored now (one pending inquiry); no count went down.
    const after = await readerTotals(tenant.environmentId);
    for (const [key, value] of Object.entries(before)) {
      expect(after[key] ?? 0, key).toBeGreaterThanOrEqual(value);
    }
    expect(after['analytics_inquiry_daily.finished']).toBe(
      before['analytics_inquiry_daily.finished'],
    );
    expect(after['analytics_check_daily.count']).toBe(before['analytics_check_daily.count']);
    expect(after['analytics_signal_daily.count']).toBe(
      (before['analytics_signal_daily.count'] ?? 0) + 19,
    );
  });

  it('records nothing for a closed day, whose counts stay as they are', async () => {
    const before = await readerTotals(tenant.environmentId);
    await redact(ids.closed ?? '');
    expect(await readerTotals(tenant.environmentId)).toEqual(before);
    const redacted = await db
      .select()
      .from(analyticsInquiryDaily)
      .where(eq(analyticsInquiryDaily.day, '2026-02-20'));
    expect(redacted.map((row) => row.source)).toEqual(['facts']);
  });

  it('adds nothing for an inquiry already redacted', async () => {
    const before = await readerTotals(tenant.environmentId);
    await recordRedactedContributionInTx(db, {
      environmentId: tenant.environmentId,
      inquiryId: ids.open0 ?? '',
      at: clock.now(),
    });
    expect(await readerTotals(tenant.environmentId)).toEqual(before);
  });

  it('recomputes the day at once when the facts hold an earlier outcome than the inquiry has now', async () => {
    const now = clock.now().toISOString();
    await db.execute(sql`update inquiries set status = 'completed', completed_at = ${now}::timestamptz,
      updated_at = ${now}::timestamptz where id = ${ids.pending ?? ''}`);
    await redact(ids.pending ?? '');
    const totals = await readerTotals(tenant.environmentId);
    // The day now counts its two unredacted finished inquiries and the two redacted ones.
    const finished = await db.execute<{
      finished: number;
    }>(sql`select sum(finished)::int as finished
      from analytics_inquiry_daily where environment_id = ${tenant.environmentId}
        and day = '2026-04-07'`);
    expect((finished as { rows: { finished: number }[] }).rows[0]?.finished).toBe(4);
    expect(totals['analytics_inquiry_daily.created']).toBeGreaterThan(0);
  });

  it('keeps the current day’s live counts in its redacted rows', async () => {
    clock.set(new Date('2026-04-11T09:00:00Z'));
    const today = await seedAnalyticsInquiry(db, tenant, {
      createdAt: new Date('2026-04-11T08:00:00Z'),
      status: 'pending',
    });
    await redact(today);
    const rows = await db
      .select()
      .from(analyticsInquiryDaily)
      .where(eq(analyticsInquiryDaily.day, '2026-04-11'));
    expect(rows.map((row) => [row.source, row.created, row.started])).toEqual([['redacted', 1, 1]]);
  });
});

describe('the C16 retention steps (C163.6; review P20)', () => {
  it('remove rollup rows past analytics-retention-months and assignee rows past their own window', async () => {
    const tenant = await seedAnalyticsTenant(db);
    await setAnalyticsSettings(db, tenant.environmentId, {
      'analytics-retention-months': 13,
      'analytics-assignee-retention-months': 1,
    });
    const template = await seedAnalyticsCaseTemplate(db, tenant);
    const reviewer = await seedAnalyticsUser(db, tenant);
    const histogram = Array.from({ length: 40 }, () => 0);
    const inquiryRow = (day: string) => ({
      environmentId: tenant.environmentId,
      day,
      timeZone: 'UTC',
      source: 'facts' as const,
      inquiryTemplateId: tenant.templateId,
      inquiryTemplateVersionId: tenant.versionId,
      created: 1,
      finishSecondsHistogram: histogram,
    });
    await db
      .insert(analyticsInquiryDaily)
      .values([inquiryRow('2025-03-09'), inquiryRow('2025-03-10'), inquiryRow('2026-04-01')]);
    const assigneeRow = (day: string) => ({
      environmentId: tenant.environmentId,
      day,
      timeZone: 'UTC',
      source: 'facts' as const,
      caseTemplateId: template.id,
      userId: reviewer,
      assigned: 1,
    });
    await db
      .insert(analyticsCaseAssigneeDaily)
      .values([assigneeRow('2026-03-09'), assigneeRow('2026-03-10'), assigneeRow('2026-04-01')]);

    const report = await runAnalyticsRetention({ db }, { now: NOW, limit: 1 });

    expect(report).toEqual({ deletedAnalyticsRollupRows: 1, deletedAnalyticsAssigneeRows: 1 });
    const kept = await db
      .select({ day: analyticsInquiryDaily.day })
      .from(analyticsInquiryDaily)
      .where(eq(analyticsInquiryDaily.environmentId, tenant.environmentId));
    expect(kept.map((row) => row.day).sort()).toEqual(['2025-03-10', '2026-04-01']);
  });
});

describe('the settings hook (C163.2)', () => {
  it('refuses a reporting zone the database does not know, and passes one it knows', async () => {
    const tenant = await seedAnalyticsTenant(db);
    await expect(
      onAnalyticsSettingsChangedInTx(
        db,
        tenant.environmentId,
        {},
        {
          'analytics-time-zone': 'Europe/Atlantis',
        },
      ),
    ).rejects.toBeInstanceOf(UnprocessableContentError);
    await expect(
      onAnalyticsSettingsChangedInTx(
        db,
        tenant.environmentId,
        {},
        {
          'analytics-time-zone': 'Asia/Tokyo',
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('a deleted user’s assignee rows (C163.3, C174.5; review P20)', () => {
  it('are re-keyed to former user, added into that day’s former-user row, in the organisation only', async () => {
    const tenant = await seedAnalyticsTenant(db);
    const other = await seedAnalyticsTenant(db);
    const template = await seedAnalyticsCaseTemplate(db, tenant);
    const otherTemplate = await seedAnalyticsCaseTemplate(db, other);
    const leaving = await seedAnalyticsUser(db, tenant);
    const elsewhere = await seedAnalyticsUser(db, other);
    const row = (environmentId: string, caseTemplateId: string, userId: string | null) => ({
      environmentId,
      day: '2026-04-01',
      timeZone: 'UTC',
      source: 'facts' as const,
      caseTemplateId,
      userId,
      assigned: 2,
      resolved: 1,
    });
    await db
      .insert(analyticsCaseAssigneeDaily)
      .values([
        row(tenant.environmentId, template.id, leaving),
        row(tenant.environmentId, template.id, null),
        row(other.environmentId, otherTemplate.id, elsewhere),
      ]);

    await forgetAnalyticsAssigneeInTx(db, {
      organizationId: tenant.organizationId,
      userId: leaving,
    });

    const rowsOf = async (environmentId: string) =>
      db
        .select()
        .from(analyticsCaseAssigneeDaily)
        .where(eq(analyticsCaseAssigneeDaily.environmentId, environmentId));
    const mine = await rowsOf(tenant.environmentId);
    expect(mine.map((entry) => [entry.userId, entry.assigned, entry.resolved])).toEqual([
      [null, 4, 2],
    ]);
    expect(await rowsOf(other.environmentId)).toHaveLength(1);
    // The same call for a user with no rows changes nothing.
    await forgetAnalyticsAssigneeInTx(db, {
      organizationId: tenant.organizationId,
      userId: testId('usr'),
    });
    expect(await rowsOf(tenant.environmentId)).toHaveLength(1);
  });
});
