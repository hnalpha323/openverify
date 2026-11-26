/**
 * K9-24 (Workflow 9D, S4B-14) on PGlite, the rollups 0032 makes possible:
 * - AL6: each inquiry's first person-visible step is entered from the reserved start `$start`, so
 *   the entry step has transitions into it;
 * - AL7: a check's reasons are kept per verification type and requirement, so a check used both
 *   ways never has its reasons combined;
 * - AA6: a closed day stays closed: a raised `analytics-settle-days` never reopens a day the rollup
 *   closed under the earlier window (`closed_through`).
 *
 * Every value is synthetic; time comes from the injected clock.
 */
import { analyticsInquiryDaily, type Db } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAnalyticsRollup } from '../../jobs/analytics/rollup.js';
import { createCapturingLogger } from '../../jobs/testing.js';
import { fixedClock } from '../../test-support/fakes.js';
import { computeCohortRollups } from './rollup-sql.js';
import {
  seedAnalyticsInquiry,
  seedAnalyticsSteps,
  seedAnalyticsTenant,
  seedAnalyticsVerification,
  setAnalyticsSettings,
  type AnalyticsTenant,
} from './testing.js';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const facts = (tenant: AnalyticsTenant, day: string) =>
  computeCohortRollups(
    db,
    {
      environmentId: tenant.environmentId,
      timeZone: 'UTC',
      source: 'facts',
      selection: { kind: 'facts', from: day, to: day },
    },
    'all',
  );

describe('the entry step’s transition from the start (AL6)', () => {
  it('counts one transition from $start into each inquiry’s first step, and the moves after it', async () => {
    const tenant = await seedAnalyticsTenant(db);
    const createdAt = new Date('2026-03-10T09:00:00Z');
    for (const steps of [['consent', 'selfie'], ['consent', 'selfie'], ['consent']]) {
      const id = await seedAnalyticsInquiry(db, tenant, { createdAt, status: 'pending' });
      await seedAnalyticsSteps(
        db,
        tenant,
        id,
        steps.map((stepId) => ({ stepId, type: stepId })),
        createdAt,
      );
    }

    const { transition } = await facts(tenant, '2026-03-10');

    expect(
      transition.map((row) => [`${row.fromStepId}>${row.toStepId}`, row.count]).sort(),
    ).toEqual([
      ['$start>consent', 3],
      ['consent>selfie', 2],
    ]);
  });
});

describe('a check’s reasons per type and requirement (AL7)', () => {
  it('keeps the reasons of a check used as required and as not required apart', async () => {
    const tenant = await seedAnalyticsTenant(db);
    const createdAt = new Date('2026-03-11T09:00:00Z');
    for (const requirement of ['required', 'not_required', 'not_required'] as const) {
      const id = await seedAnalyticsInquiry(db, tenant, { createdAt, status: 'pending' });
      await seedAnalyticsVerification(db, tenant, id, {
        type: 'government_id',
        status: 'failed',
        createdAt,
        checks: [{ name: 'id_expired', status: 'failed', requirement, reasons: ['expired'] }],
      });
    }

    const { checkReason } = await facts(tenant, '2026-03-11');

    expect(checkReason).toHaveLength(2);
    expect(checkReason).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verificationType: 'government_id',
          checkName: 'id_expired',
          requirement: 'required',
          reason: 'expired',
          count: 1,
        }),
        expect.objectContaining({
          verificationType: 'government_id',
          checkName: 'id_expired',
          requirement: 'not_required',
          reason: 'expired',
          count: 2,
        }),
      ]),
    );
  });
});

describe('a closed day under a raised settle window (AA6)', () => {
  it('stays as it was closed, and the state says through which day', async () => {
    const tenant = await seedAnalyticsTenant(db);
    await setAnalyticsSettings(db, tenant.environmentId, {
      'analytics-time-zone': 'UTC',
      'analytics-settle-days': 2,
    });
    const id = await seedAnalyticsInquiry(db, tenant, {
      createdAt: new Date('2026-04-05T10:00:00Z'),
      status: 'completed',
      finished: { as: 'completed', afterSeconds: 600 },
    });
    const clock = fixedClock(new Date('2026-04-10T12:00:00Z'));
    const pass = () => runAnalyticsRollup({ db, clock, logger: createCapturingLogger() });
    const approvedOn = async (day: string) =>
      (
        await db
          .select()
          .from(analyticsInquiryDaily)
          .where(
            and(
              eq(analyticsInquiryDaily.environmentId, tenant.environmentId),
              eq(analyticsInquiryDaily.day, day),
              eq(analyticsInquiryDaily.source, 'facts'),
            ),
          )
      ).reduce((total, row) => total + row.approved, 0);
    const closedThrough = async () => {
      const result = await db.execute(
        sql`select closed_through::text as closed from analytics_rollup_state
          where environment_id = ${tenant.environmentId}`,
      );
      return (result as { rows: { closed: string | null }[] }).rows[0]?.closed;
    };

    await pass();
    // Today is 2026-04-10, two settle days: 2026-04-08 and later are open, 2026-04-07 is closed.
    expect(await closedThrough()).toBe('2026-04-07');

    await db.execute(sql`update inquiries set status = 'approved', updated_at = now()
      where id = ${id}`);
    await setAnalyticsSettings(db, tenant.environmentId, { 'analytics-settle-days': 30 });
    clock.set(new Date('2026-04-11T00:10:00Z'));
    await pass();

    expect(await approvedOn('2026-04-05')).toBe(0);
    expect(await closedThrough()).toBe('2026-04-07');
  });
});
