/**
 * C163.2, C163.4 (Workflow 9B, `api-analytics`; decisions 36 and 72, reviews H04, H28, P21): the
 * `analytics-rollup` pass and the `analytics-rebuild` job on a test database:
 * - the first pass builds every past day with activity, never the current day, and writes the state;
 * - a 5-minute pass refreshes only the live counts of a dirty open day, its outcomes kept, and a rerun
 *   is harmless;
 * - the first pass after the zone's midnight stores the day that closed and recomputes every open
 *   day's outcomes, recording `outcomes-as-of`;
 * - a closed day is frozen;
 * - a zone change hands the environment to the rebuild (queued, or inline without a producer), which
 *   rebuilds only the open days in the new zone; a closed day keeps its zone;
 * - one environment's failure never stops the others, and is logged by id only.
 * Every value is synthetic.
 */
import { analyticsInquiryDaily, analyticsRollupState, type Db } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalyticsRebuildJob } from '../../ports.js';
import {
  seedAnalyticsInquiry,
  seedAnalyticsTenant,
  setAnalyticsSettings,
  type AnalyticsTenant,
} from '../../services/analytics/testing.js';
import { fixedClock } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { processAnalyticsRebuild } from './rebuild.js';
import { runAnalyticsRollup } from './rollup.js';

const PARIS = 'Europe/Paris';
/** 12:00 in Paris (summer time, UTC+2) on 2026-04-10. */
const NOW = new Date('2026-04-10T10:00:00Z');
const MINUTE = 60_000;

let database: TestDatabase;
let db: Db;
let tenant: AnalyticsTenant;
const ids: Record<string, string> = {};

/** The inquiry rollup's `facts` row of a day, summed over its dimensions. */
async function factsOf(day: string, environmentId = tenant.environmentId) {
  const rows = await db
    .select()
    .from(analyticsInquiryDaily)
    .where(
      and(
        eq(analyticsInquiryDaily.environmentId, environmentId),
        eq(analyticsInquiryDaily.day, day),
        eq(analyticsInquiryDaily.source, 'facts'),
      ),
    );
  return {
    rows: rows.length,
    zones: [...new Set(rows.map((row) => row.timeZone))],
    created: rows.reduce((total, row) => total + row.created, 0),
    started: rows.reduce((total, row) => total + row.started, 0),
    finished: rows.reduce((total, row) => total + row.finished, 0),
    approved: rows.reduce((total, row) => total + row.approved, 0),
  };
}

async function stateOf(environmentId = tenant.environmentId) {
  const [row] = await db
    .select()
    .from(analyticsRollupState)
    .where(eq(analyticsRollupState.environmentId, environmentId));
  return row;
}

const logger = createCapturingLogger();
const clock = fixedClock(NOW);
const pass = (rebuilds?: { enqueueAnalyticsRebuild(job: AnalyticsRebuildJob): Promise<void> }) =>
  runAnalyticsRollup({ db, clock, logger, ...(rebuilds === undefined ? {} : { rebuilds }) });

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  tenant = await seedAnalyticsTenant(db);
  await setAnalyticsSettings(db, tenant.environmentId, { 'analytics-time-zone': PARIS });
  // A closed day (40 days back), an open day, an open day not started yet, and the current day.
  ids.closed = await seedAnalyticsInquiry(db, tenant, {
    createdAt: new Date('2026-03-01T10:00:00Z'),
    status: 'completed',
    finished: { as: 'completed', afterSeconds: 600 },
  });
  ids.open = await seedAnalyticsInquiry(db, tenant, {
    createdAt: new Date('2026-04-05T10:00:00Z'),
    status: 'pending',
  });
  ids.waiting = await seedAnalyticsInquiry(db, tenant, {
    createdAt: new Date('2026-04-05T11:00:00Z'),
    status: 'created',
  });
  ids.today = await seedAnalyticsInquiry(db, tenant, {
    createdAt: new Date('2026-04-10T08:00:00Z'),
    status: 'pending',
  });
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('the first analytics-rollup pass (C163.4)', () => {
  it('builds every past day with activity, never the current day, and writes the state', async () => {
    const result = await pass();
    expect(result).toMatchObject({ environments: 1, rebuildsQueued: 0, failed: 0 });
    expect(await factsOf('2026-03-01')).toMatchObject({ created: 1, started: 1, finished: 1 });
    expect(await factsOf('2026-04-05')).toMatchObject({ created: 2, started: 1, finished: 0 });
    expect(await factsOf('2026-04-10')).toMatchObject({ rows: 0 });
    const state = await stateOf();
    expect(state?.rolledUpThrough?.toISOString()).toBe(
      new Date(NOW.getTime() - 2 * MINUTE).toISOString(),
    );
    expect(state?.outcomesAsOf?.toISOString()).toBe(state?.rolledUpThrough?.toISOString());
    expect(state?.timeZone).toBe(PARIS);
  });
});

describe('a 5-minute pass (C163.4; review P21)', () => {
  it('refreshes only the live counts of a dirty open day, its outcomes kept as the day’s refresh left them', async () => {
    clock.set(new Date(NOW.getTime() + 5 * MINUTE));
    const touched = new Date(NOW.getTime() + MINUTE).toISOString();
    await db.execute(sql`update inquiries set status = 'pending', started_at = ${touched}::timestamptz,
      updated_at = ${touched}::timestamptz where id = ${ids.waiting ?? ''}`);
    await db.execute(sql`update inquiries set status = 'completed', completed_at = ${touched}::timestamptz,
      updated_at = ${touched}::timestamptz where id = ${ids.open ?? ''}`);

    await pass();

    expect(await factsOf('2026-04-05')).toMatchObject({ created: 2, started: 2, finished: 0 });
    const state = await stateOf();
    expect(state?.rolledUpThrough?.toISOString()).toBe(
      new Date(NOW.getTime() + 3 * MINUTE).toISOString(),
    );
    expect(state?.outcomesAsOf?.toISOString()).toBe(
      new Date(NOW.getTime() - 2 * MINUTE).toISOString(),
    );
  });

  it('is harmless to rerun: the same rows again', async () => {
    const before = await factsOf('2026-04-05');
    await pass();
    expect(await factsOf('2026-04-05')).toEqual(before);
  });
});

describe('the first pass after the zone’s midnight (C163.4; review P21)', () => {
  it('stores the day that closed and recomputes the open days’ outcomes, once', async () => {
    // 02:10 in Paris on 2026-04-11.
    clock.set(new Date('2026-04-11T00:10:00Z'));
    await pass();
    expect(await factsOf('2026-04-05')).toMatchObject({ created: 2, started: 2, finished: 1 });
    expect(await factsOf('2026-04-10')).toMatchObject({ created: 1, started: 1 });
    expect((await stateOf())?.outcomesAsOf?.toISOString()).toBe('2026-04-11T00:08:00.000Z');
  });

  it('leaves a closed day frozen, whatever happens to its inquiries', async () => {
    await db.execute(sql`update inquiries set status = 'approved', updated_at = now()
      where id = ${ids.closed ?? ''}`);
    clock.set(new Date('2026-04-12T00:10:00Z'));
    await pass();
    expect(await factsOf('2026-03-01')).toMatchObject({ created: 1, finished: 1, approved: 0 });
  });
});

describe('a zone change (C163.2; review H04)', () => {
  it('queues analytics-rebuild through the producer, and refreshes nothing until it runs', async () => {
    await setAnalyticsSettings(db, tenant.environmentId, {
      'analytics-time-zone': 'America/New_York',
    });
    const queued: AnalyticsRebuildJob[] = [];
    const result = await pass({
      enqueueAnalyticsRebuild: (job) => {
        queued.push(job);
        return Promise.resolve();
      },
    });
    expect(queued).toEqual([{ environmentId: tenant.environmentId }]);
    expect(result.rebuildsQueued).toBe(1);
    expect((await stateOf())?.timeZone).toBe(PARIS);
  });

  it('rebuilds only the open days in the new zone; a closed day keeps the zone it was built in', async () => {
    const { days } = await processAnalyticsRebuild(
      { environmentId: tenant.environmentId },
      { db, clock, logger },
    );
    expect(days).toBeGreaterThan(0);
    expect((await factsOf('2026-04-05')).zones).toEqual(['America/New_York']);
    expect((await factsOf('2026-03-01')).zones).toEqual([PARIS]);
    expect((await stateOf())?.timeZone).toBe('America/New_York');
  });

  it('rebuilds in the pass itself when no producer is given', async () => {
    await setAnalyticsSettings(db, tenant.environmentId, { 'analytics-time-zone': PARIS });
    const result = await pass();
    expect(result.failed).toBe(0);
    expect((await factsOf('2026-04-05')).zones).toEqual([PARIS]);
    expect((await stateOf())?.timeZone).toBe(PARIS);
  });

  it('rebuilds nothing for an environment that does not exist or was never rolled up', async () => {
    await expect(
      processAnalyticsRebuild(
        { environmentId: 'env_01M5CJXHG0000000000000000A' },
        { db, clock, logger },
      ),
    ).resolves.toEqual({ days: 0 });
  });
});

describe('one environment’s failure (C163.4)', () => {
  it('is counted and logged by id only, and never stops the others', async () => {
    const broken = await seedAnalyticsTenant(db);
    await seedAnalyticsInquiry(db, broken, { createdAt: new Date('2026-04-09T10:00:00Z') });
    // A zone the settings route would refuse, written behind its back.
    await setAnalyticsSettings(db, broken.environmentId, { 'analytics-time-zone': 'Mars/Olympus' });
    const fresh = await seedAnalyticsTenant(db);
    await seedAnalyticsInquiry(db, fresh, { createdAt: new Date('2026-04-09T10:00:00Z') });
    logger.entries.length = 0;

    const result = await pass();

    expect(result.failed).toBe(1);
    expect((await factsOf('2026-04-09', fresh.environmentId)).created).toBe(1);
    const failure = logger.entries.find((entry) => entry.level === 'error');
    expect(failure?.object).toMatchObject({
      queue: 'analytics-rollup',
      environmentId: broken.environmentId,
    });
    expect(Object.keys(failure?.object ?? {}).sort()).toEqual(['environmentId', 'error', 'queue']);
  });
});
