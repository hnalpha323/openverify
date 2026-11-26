/**
 * C164.7, C164.8 (Workflow 9B, `api-analytics`; reviews H17, H18, H27, H28, P20, P21): the six
 * aggregate answers on real rollups of a seeded synthetic population, through the routes:
 * - the contract's documents (the response schema refuses any visible count from 1 to the threshold
 *   minus one and any outcome on a live day), the reporting zone, the threshold, the settle window
 *   and the freshness of the state;
 * - small counts hidden, zero shown, and complementary suppression so no hidden day follows from the
 *   week or the window's total;
 * - the current day live, with created and started alone;
 * - filters applied before suppression; a filter the rollups cannot apply refused, never ignored;
 * - one environment per answer;
 * - the per-reviewer distribution only for holders of users:write (P20);
 * - "no step data" before the first step record (H17); a check that never ran is "not run".
 * Every value is synthetic.
 */
import {
  analyticsCasesDocumentSchema,
  analyticsChecksDocumentSchema,
  analyticsFunnelDocumentSchema,
  analyticsInquiriesDocumentSchema,
  analyticsSignalsDocumentSchema,
  analyticsVerificationsDocumentSchema,
} from '@openverify/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAnalyticsRollup } from '../../jobs/analytics/rollup.js';
import { createCapturingLogger, createMemoryStorage } from '../../jobs/testing.js';
import type { RedactionService } from '../../ports.js';
import { createRedactionService } from '../../services/redaction.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  analyticsTenantOf,
  seedAnalyticsCase,
  seedAnalyticsCaseTemplate,
  seedAnalyticsInquiry,
  seedAnalyticsSteps,
  seedAnalyticsUser,
  seedAnalyticsVerification,
  setAnalyticsSettings,
  type AnalyticsTenant,
} from '../../services/analytics/testing.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
} from '../../test-support/fakes.js';
import { bearer } from '../../test-support/harness.js';

const ZONE = 'Europe/Paris';
/** 12:00 in Paris on Friday 2026-04-10. */
const NOW = new Date('2026-04-10T10:00:00Z');
const WEEK = 'filter[from]=2026-04-06&filter[to]=2026-04-10';

let api: InquiryTestApi;
let tenant: AnalyticsTenant;
let token: string;
let reviewer: string;

const at = (day: string, hour = 9) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);

async function read(path: string, query: string, credential = token) {
  return api.app.inject({ url: `/api/v1/analytics/${path}?${query}`, headers: bearer(credential) });
}

/** The app's redaction service, the real one once the database exists (C163.4 through the route). */
let realRedaction: RedactionService | undefined;
const real = (): RedactionService => {
  if (realRedaction === undefined) {
    throw new Error('the redaction service is built once the database exists');
  }
  return realRedaction;
};
const redaction: RedactionService = {
  redactInquiry: (...args) => real().redactInquiry(...args),
  redactAccount: (...args) => real().redactAccount(...args),
  redactReport: (...args) => real().redactReport(...args),
  redactTransaction: (...args) => real().redactTransaction(...args),
  redactCase: (...args) => real().redactCase(...args),
};

beforeAll(async () => {
  api = await createInquiryTestApi({ redaction });
  realRedaction = createRedactionService({
    db: api.database.db,
    storage: createMemoryStorage(),
    events: createRecordingEventPublisher(),
    clock: api.clock,
    audit: createRecordingAuditLogger(),
  });
  api.clock.set(NOW);
  const created = await api.newTenant();
  token = created.token;
  tenant = await analyticsTenantOf(api.database.db, created);
  const { db } = api.database;
  await setAnalyticsSettings(db, tenant.environmentId, { 'analytics-time-zone': ZONE });
  // Monday: 12 completed through the flow, each with a step record and a passed attempt.
  for (let index = 0; index < 12; index += 1) {
    const id = await seedAnalyticsInquiry(db, tenant, {
      createdAt: at('2026-04-06'),
      status: 'completed',
      finished: { as: 'completed', afterSeconds: 300 },
      platform: 'web',
      flowOutcome: { verificationTypesOnPath: ['government-id'], fallbacksTaken: [], flags: [] },
    });
    await seedAnalyticsSteps(
      db,
      tenant,
      id,
      [
        { stepId: 'start', type: 'consent' },
        { stepId: 'document', type: 'government_id' },
        { stepId: 'done', type: 'completion' },
      ],
      at('2026-04-06'),
    );
    await seedAnalyticsVerification(db, tenant, id, {
      type: 'government_id',
      status: 'passed',
      country: 'FR',
      captureMethod: 'camera',
      checks: [{ name: 'id_barcode_detection', status: 'passed' }],
    });
  }
  // Tuesday: three, a small count. Wednesday: none. Thursday: 11 completed and 4 failed, on Android.
  for (let index = 0; index < 3; index += 1) {
    await seedAnalyticsInquiry(db, tenant, { createdAt: at('2026-04-07'), status: 'pending' });
  }
  for (let index = 0; index < 15; index += 1) {
    await seedAnalyticsInquiry(db, tenant, {
      createdAt: at('2026-04-09'),
      status: index < 11 ? 'completed' : 'failed',
      finished: { as: index < 11 ? 'completed' : 'failed', afterSeconds: 7_200 },
      platform: 'android',
      flowOutcome: { verificationTypesOnPath: [], fallbacksTaken: [], flags: [] },
    });
  }
  // Friday (today): two started, live.
  for (let index = 0; index < 2; index += 1) {
    await seedAnalyticsInquiry(db, tenant, { createdAt: at('2026-04-10', 8), status: 'pending' });
  }
  // Cases on Monday, assigned to one reviewer.
  const template = await seedAnalyticsCaseTemplate(db, tenant);
  reviewer = await seedAnalyticsUser(db, tenant);
  for (let index = 0; index < 12; index += 1) {
    await seedAnalyticsCase(db, tenant, template, {
      createdAt: at('2026-04-06'),
      resolvedAfterSeconds: 3_600,
      slaMet: true,
      assigneeId: reviewer,
    });
  }
  // Another environment's inquiries never reach this one's answers.
  const other = await analyticsTenantOf(db, await api.newTenant());
  for (let index = 0; index < 20; index += 1) {
    await seedAnalyticsInquiry(db, other, { createdAt: at('2026-04-08'), status: 'pending' });
  }
  await runAnalyticsRollup({ db, clock: api.clock, logger: createCapturingLogger() });
}, 120_000);

afterAll(async () => {
  await api.close();
});

describe('GET /analytics/inquiries (C164.1, C164.7, C164.8)', () => {
  it('answers the contract’s document, naming the zone, threshold, settle window and freshness', async () => {
    const response = await read('inquiries', WEEK);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = analyticsInquiriesDocumentSchema.parse(response.json());
    expect(data.attributes).toMatchObject({
      'time-zone': ZONE,
      'time-zones': [ZONE],
      from: '2026-04-06',
      to: '2026-04-10',
      bucket: 'day',
      threshold: 11,
      'settle-days': 30,
      freshness: {
        'rolled-up-through': '2026-04-10T09:58:00.000Z',
        'outcomes-as-of': '2026-04-10T09:58:00.000Z',
      },
    });
    expect(data.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hides a small count, shows zero, and serves the current day live with created and started alone', async () => {
    const { data } = analyticsInquiriesDocumentSchema.parse((await read('inquiries', WEEK)).json());
    const byDay = Object.fromEntries(
      data.attributes.buckets.map((bucket) => [bucket.start, bucket]),
    );
    expect(byDay['2026-04-07']?.counts.created).toEqual({ suppressed: 'small-count' });
    expect(byDay['2026-04-08']?.counts.created).toBe(0);
    expect(byDay['2026-04-10']).toMatchObject({ live: true, 'time-zone': ZONE });
    expect(Object.keys(byDay['2026-04-10']?.counts ?? {}).sort()).toEqual(['created', 'started']);
    expect(byDay['2026-04-10']?.rates).toBeUndefined();
    expect(data.attributes['suppressed-cells']).toBeGreaterThan(0);
  });

  it('never lets a hidden day follow from the week’s total and the days shown (complementary)', async () => {
    const window = 'filter[from]=2026-04-06&filter[to]=2026-04-09';
    for (const bucket of ['day', 'week'] as const) {
      const { data } = analyticsInquiriesDocumentSchema.parse(
        (await read('inquiries', `${window}&bucket=${bucket}`)).json(),
      );
      if (bucket === 'week') {
        // The week is the window: its total is the same cell whatever bucket is asked.
        expect(data.attributes.buckets[0]?.counts.created).toEqual(
          data.attributes.totals.counts.created,
        );
      }
    }
    const { data } = analyticsInquiriesDocumentSchema.parse(
      (await read('inquiries', `${window}&bucket=day`)).json(),
    );
    const days = data.attributes.buckets.map((bucket) => bucket.counts.created);
    const total = data.attributes.totals.counts.created;
    const hidden = [...days, total].filter((cell) => typeof cell !== 'number');
    // Tuesday's 3 is hidden; at least one more cell of the day/total relation is hidden with it.
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });

  it('bounds a rate whose complement is small, never showing it exactly', async () => {
    const { data } = analyticsInquiriesDocumentSchema.parse(
      (await read('inquiries', 'filter[from]=2026-04-06&filter[to]=2026-04-09&bucket=week')).json(),
    );
    // 23 of 27 finished succeeded: the 4 failures are under the threshold, so the rate is a bound
    // or hidden, never its exact value.
    const rate = data.attributes.totals.rates['success-rate'];
    expect(rate).toBeDefined();
    expect(rate !== undefined && 'value' in rate).toBe(false);
    const finish = data.attributes.totals['time-to-finish'];
    expect(finish !== null && 'lower' in finish && finish.lower < finish.upper).toBe(true);
  });

  it('applies a filter before suppression, and counts one environment only', async () => {
    const { data } = analyticsInquiriesDocumentSchema.parse(
      (await read('inquiries', `${WEEK}&filter[platform]=android&bucket=week`)).json(),
    );
    expect(data.attributes.buckets[0]?.counts.created).toBe(15);
    const all = analyticsInquiriesDocumentSchema.parse((await read('inquiries', WEEK)).json());
    const wednesday = all.data.attributes.buckets.find((bucket) => bucket.start === '2026-04-08');
    expect(wednesday?.counts.created).toBe(0);
  });

  it('answers filter[tag] from the tag rollup, its four counts', async () => {
    const response = await read('inquiries', `${WEEK}&filter[tag]=synthetic`);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = analyticsInquiriesDocumentSchema.parse(response.json());
    expect(Object.keys(data.attributes.totals.counts).sort()).toEqual([
      'completed',
      'created',
      'failed',
      'finished',
    ]);
  });
});

describe('GET /analytics/funnel (C164.2; review H17)', () => {
  it('serves each version’s steps from the step record, with no step data before the first one', async () => {
    const response = await read('funnel', 'filter[from]=2026-04-05&filter[to]=2026-04-09');
    expect(response.statusCode, response.body).toBe(200);
    const { data } = analyticsFunnelDocumentSchema.parse(response.json());
    expect(data.attributes.totals['step-data-from']).toBe('2026-04-06');
    expect(data.attributes.buckets.map((bucket) => [bucket.start, bucket['step-data']])).toEqual([
      ['2026-04-05', false],
      ['2026-04-06', true],
      ['2026-04-07', true],
      ['2026-04-08', true],
      ['2026-04-09', true],
    ]);
    const [version] = data.attributes.totals.versions;
    expect(version?.['inquiry-template-version-id']).toBe(tenant.versionId);
    expect(version?.steps.map((step) => step['step-id'])).toEqual(['document', 'done', 'start']);
    expect(version?.steps.find((step) => step['step-id'] === 'start')?.counts.entered).toBe(12);
  });

  it('refuses a device filter its step rollups cannot apply, never answering unfiltered', async () => {
    const response = await read('funnel', `${WEEK}&filter[platform]=web`);
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /analytics/verifications and /analytics/checks (C164.3, C164.4)', () => {
  it('groups attempts by type, capture method and country, with the per-attempt rate', async () => {
    const response = await read('verifications', WEEK);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = analyticsVerificationsDocumentSchema.parse(response.json());
    const [group, ...others] = data.attributes.totals.groups;
    expect(others).toEqual([]);
    expect(group).toMatchObject({
      'verification-type': 'government-id',
      'capture-method': 'camera',
      country: 'FR',
    });
    expect(group?.counts).toMatchObject({ created: 12, passed: 12 });
    const live = data.attributes.buckets.find((bucket) => bucket.live);
    expect(live?.counts).toEqual({});
  });

  it('lists each check with its tier and stage, and a check of the type that never ran as not run', async () => {
    const response = await read('checks', WEEK);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = analyticsChecksDocumentSchema.parse(response.json());
    const ran = data.attributes.totals.checks.find(
      (check) => check['check-name'] === 'id_barcode_detection',
    );
    expect(ran).toMatchObject({ ran: true, 'verification-type': 'government-id' });
    expect(ran?.counts).toMatchObject({ runs: 12, passed: 12, failed: 0 });
    const unrun = data.attributes.totals.checks.filter((check) => !check.ran);
    expect(unrun.length).toBeGreaterThan(0);
    expect(unrun.every((check) => Object.keys(check.counts).length === 0)).toBe(true);
  });
});

describe('GET /analytics/cases (C164.5; review P20)', () => {
  it('serves the per-reviewer distribution only to a holder of users:write', async () => {
    const asKey = analyticsCasesDocumentSchema.parse((await read('cases', WEEK)).json());
    expect(asKey.data.attributes.totals.assignees).toBeNull();
    expect(asKey.data.attributes.totals.counts).toMatchObject({ created: 12, resolved: 12 });

    const viewer = api.newUserToken(tenant.environmentId, { permissions: ['analytics:read'] });
    const asViewer = analyticsCasesDocumentSchema.parse((await read('cases', WEEK, viewer)).json());
    expect(asViewer.data.attributes.totals.assignees).toBeNull();

    const admin = api.newUserToken(tenant.environmentId, {
      permissions: ['analytics:read', 'users:write'],
    });
    const asAdmin = analyticsCasesDocumentSchema.parse((await read('cases', WEEK, admin)).json());
    expect(asAdmin.data.attributes.totals.assignees).toEqual([
      { 'user-id': reviewer, counts: { assigned: 12, resolved: 12 } },
    ]);
  });
});

describe('GET /analytics/signals (C164.6)', () => {
  it('lists every registry signal with tier, stage, its bins and not evaluated', async () => {
    const response = await read('signals', WEEK);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = analyticsSignalsDocumentSchema.parse(response.json());
    expect(data.attributes.totals.signals).toHaveLength(19);
    const bot = data.attributes.totals.signals.find(
      (signal) => signal.name === 'inquiry/bot_score',
    );
    expect(bot?.bins.map((bin) => bin.bin)).toHaveLength(10);
    expect(bot?.['not-evaluated']).toBe(30);
  });
});

describe('the answers over time (C163.4; reviews H04, H28)', () => {
  it('keeps every count when an open day’s inquiry is redacted through POST /inquiries/:id/redact', async () => {
    const { db } = api.database;
    const before = (await read('inquiries', WEEK)).json<{ data: { attributes: unknown } }>();
    const result = await db.execute<{ id: string }>(sql`select id from inquiries
      where environment_id = ${tenant.environmentId}
        and created_at = ${at('2026-04-06').toISOString()}::timestamptz
      order by id limit 1`);
    const id = (result as { rows: { id: string }[] }).rows[0]?.id ?? '';
    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${id}/redact`,
      headers: bearer(token),
    });
    expect(response.statusCode, response.body).toBe(200);
    const redacted = await db.execute<{ at: Date | null }>(
      sql`select redacted_at as at from inquiries where id = ${id}`,
    );
    expect((redacted as { rows: { at: Date | null }[] }).rows[0]?.at).not.toBeNull();
    const after = (await read('inquiries', WEEK)).json<{ data: { attributes: unknown } }>();
    expect(after.data.attributes).toEqual(before.data.attributes);
    api.clock.set(new Date(NOW.getTime() + 5 * 60_000));
    await runAnalyticsRollup({ db, clock: api.clock, logger: createCapturingLogger() });
    const later = (await read('inquiries', WEEK)).json<{
      data: { attributes: { buckets: unknown[]; totals: unknown } };
    }>();
    const was = before.data.attributes as { buckets: unknown[]; totals: unknown };
    expect(later.data.attributes.buckets).toEqual(was.buckets);
    expect(later.data.attributes.totals).toEqual(was.totals);
  });

  it('serves a day live with the counts the same day has once it closes and is rolled up', async () => {
    const window = 'filter[from]=2026-04-10&filter[to]=2026-04-10';
    const live = analyticsInquiriesDocumentSchema.parse((await read('inquiries', window)).json());
    expect(live.data.attributes.buckets[0]?.live).toBe(true);
    // 02:10 in Paris on Saturday: Friday is closed and stored by the next pass.
    api.clock.set(new Date('2026-04-11T00:10:00Z'));
    await runAnalyticsRollup({
      db: api.database.db,
      clock: api.clock,
      logger: createCapturingLogger(),
    });
    const stored = analyticsInquiriesDocumentSchema.parse((await read('inquiries', window)).json());
    expect(stored.data.attributes.buckets[0]?.live).toBe(false);
    expect(stored.data.attributes.buckets[0]?.counts.created).toEqual(
      live.data.attributes.buckets[0]?.counts.created,
    );
    expect(stored.data.attributes.buckets[0]?.counts.started).toEqual(
      live.data.attributes.buckets[0]?.counts.started,
    );
  });
});
