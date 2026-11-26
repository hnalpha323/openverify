/**
 * C163.4, C164.7, C178.2 (Workflow 9B, `api-analytics`): the analytics rollups on a real Postgres
 * (the pinned image, `startIntegrationPostgres`):
 * - an open and a closed day unchanged by redaction, on demand and through a template version's own
 *   retention (verification round, H04);
 * - a zone change rebuilding only the open days, the redacted rows keeping their zone, so an answer
 *   names both zones (C163.2);
 * - the refresh with dirty days under concurrent writes: after the writes settle, the stored live
 *   counts are the facts recomputed from scratch;
 * - complementary suppression on real rollups: no hidden day follows from the days shown and their
 *   total, in any bucket;
 * - the read plans: each read and scan uses its index.
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import {
  analyticsInquiryDaily,
  createDatabase,
  createKeyring,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import { createIntegrationPool, startIntegrationPostgres } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processAnalyticsRebuild } from '../../jobs/analytics/rebuild.js';
import { runAnalyticsRollup } from '../../jobs/analytics/rollup.js';
import { createCapturingLogger, createMemoryStorage } from '../../jobs/testing.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import { createRedactionService } from '../redaction.js';
import { runRetention } from '../retention.js';
import { computeCohortRollups } from './rollup-sql.js';
import { readAnalyticsAnswer } from './service.js';
import {
  rollupTotals,
  seedAnalyticsCase,
  seedAnalyticsCaseTemplate,
  seedAnalyticsInquiry,
  seedAnalyticsSteps,
  seedAnalyticsTenant,
  seedAnalyticsVerification,
  setAnalyticsSettings,
  type AnalyticsTenant,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
const PARIS = 'Europe/Paris';
const NOW = new Date('2026-04-10T10:00:00Z');

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await pool.end();
  await container?.stop();
});

const logger = createCapturingLogger();

async function finishedOn(tenant: AnalyticsTenant, createdAt: Date) {
  const id = await seedAnalyticsInquiry(db, tenant, {
    createdAt,
    status: 'completed',
    finished: { as: 'completed', afterSeconds: 1_200 },
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
    createdAt,
  );
  await seedAnalyticsVerification(db, tenant, id, {
    type: 'government_id',
    status: 'passed',
    country: 'DE',
    captureMethod: 'upload',
    checks: [{ name: 'id_barcode_detection', status: 'passed' }],
  });
  return id;
}

describe('redaction leaves open and closed days unchanged (C163.4; verification round, H04)', () => {
  const clock = fixedClock(NOW);
  let tenant: AnalyticsTenant;
  const open: string[] = [];
  const closed: string[] = [];
  const redaction = () =>
    createRedactionService({
      db,
      storage: createMemoryStorage(),
      events: createRecordingEventPublisher(),
      clock,
      audit: createRecordingAuditLogger(),
    });

  beforeAll(async () => {
    tenant = await seedAnalyticsTenant(db);
    await setAnalyticsSettings(db, tenant.environmentId, { 'analytics-time-zone': PARIS });
    for (let index = 0; index < 4; index += 1) {
      open.push(await finishedOn(tenant, new Date('2026-04-06T09:00:00Z')));
      closed.push(await finishedOn(tenant, new Date('2026-02-25T09:00:00Z')));
    }
    await runAnalyticsRollup({ db, clock, logger });
  });

  it('on demand, on an open and a closed day', async () => {
    const before = await rollupTotals(db, tenant.environmentId);
    const ctx = { environmentId: tenant.environmentId, organizationId: tenant.organizationId };
    await redaction().redactInquiry(ctx, open[0] ?? '', null);
    await redaction().redactInquiry(ctx, closed[0] ?? '', null);
    expect(await rollupTotals(db, tenant.environmentId)).toEqual(before);
    clock.set(new Date('2026-04-11T00:10:00Z'));
    await runAnalyticsRollup({ db, clock, logger });
    expect(await rollupTotals(db, tenant.environmentId)).toEqual(before);
  });

  it('through the template version’s own retention, before the environment’s', async () => {
    const before = await rollupTotals(db, tenant.environmentId);
    await db.execute(sql`update inquiry_template_versions
      set settings = settings || '{"retention-days": 1}'::jsonb where id = ${tenant.versionId}`);
    const report = await runRetention({
      db,
      redaction: redaction(),
      storage: createMemoryStorage(),
      clock,
    });
    expect(report.redactedInquiries).toBe(6);
    expect(await rollupTotals(db, tenant.environmentId)).toEqual(before);
    clock.set(new Date('2026-04-12T00:10:00Z'));
    await runAnalyticsRollup({ db, clock, logger });
    expect(await rollupTotals(db, tenant.environmentId)).toEqual(before);
  });

  it('then a zone change rebuilds only the open days; redacted rows keep their zone', async () => {
    await setAnalyticsSettings(db, tenant.environmentId, {
      'analytics-time-zone': 'America/New_York',
    });
    const queued: string[] = [];
    await runAnalyticsRollup({
      db,
      clock,
      logger,
      rebuilds: {
        enqueueAnalyticsRebuild: (job) => {
          queued.push(job.environmentId);
          return Promise.resolve();
        },
      },
    });
    expect(queued).toEqual([tenant.environmentId]);
    await processAnalyticsRebuild({ environmentId: tenant.environmentId }, { db, clock, logger });
    const zones = async (day: string, source: 'facts' | 'redacted') =>
      (
        await db
          .selectDistinct({ zone: analyticsInquiryDaily.timeZone })
          .from(analyticsInquiryDaily)
          .where(
            and(
              eq(analyticsInquiryDaily.environmentId, tenant.environmentId),
              eq(analyticsInquiryDaily.day, day),
              eq(analyticsInquiryDaily.source, source),
            ),
          )
      ).map((row) => row.zone);
    expect(await zones('2026-04-06', 'redacted')).toEqual([PARIS]);
    expect(await zones('2026-02-25', 'facts')).toEqual([PARIS]);
    expect(await zones('2026-02-25', 'redacted')).toEqual([]);
    const answer = (await readAnalyticsAnswer(
      { db, clock },
      'inquiries',
      { 'filter[from]': '2026-02-20', 'filter[to]': '2026-04-10' },
      { environmentId: tenant.environmentId, mayReadAssignees: false },
    )) as { data: { attributes: { 'time-zones': string[] } } };
    expect(answer.data.attributes['time-zones']).toEqual(['America/New_York', PARIS]);
  });
});

describe('the refresh with dirty days under concurrent writes (C163.4)', () => {
  it('ends with the live counts of every open day equal to the facts recomputed from scratch', async () => {
    const clock = fixedClock(NOW);
    const tenant = await seedAnalyticsTenant(db);
    await setAnalyticsSettings(db, tenant.environmentId, { 'analytics-time-zone': PARIS });
    for (let index = 0; index < 6; index += 1) {
      await seedAnalyticsInquiry(db, tenant, {
        createdAt: new Date(`2026-04-0${String(2 + (index % 4))}T09:00:00Z`),
      });
    }
    await runAnalyticsRollup({ db, clock, logger });
    // The writes are stamped with the clock's now while two passes run with the watermark 2 minutes
    // behind it, as a commit after a pass's scan would be.
    clock.set(new Date(NOW.getTime() + 5 * 60_000));
    const touched = clock.now();
    const created = (
      await db.execute<{ id: string }>(sql`select id from inquiries
        where environment_id = ${tenant.environmentId} order by id`)
    ).rows.map((row) => row.id);
    // Six new inquiries and six started ones, each row written once (a second write of the same
    // timestamp would let the updated_at trigger stamp the database's own now).
    const writes = Array.from({ length: 12 }, async (_, index) => {
      if (index % 2 === 0) {
        await seedAnalyticsInquiry(db, tenant, {
          createdAt: new Date(`2026-04-0${String(2 + (index % 4))}T1${String(index % 10)}:00:00Z`),
          status: 'pending',
          updatedAt: touched,
        });
      } else {
        await db.execute(sql`update inquiries set status = 'pending',
            started_at = ${touched.toISOString()}::timestamptz,
            updated_at = ${touched.toISOString()}::timestamptz
          where id = ${created[(index - 1) / 2] ?? ''}`);
      }
    });
    const passes = [
      runAnalyticsRollup({ db, clock, logger }),
      runAnalyticsRollup({ db, clock, logger }),
    ];
    const settled = await Promise.allSettled([...writes, ...passes]);
    expect(settled.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
    clock.set(new Date(NOW.getTime() + 10 * 60_000));
    await runAnalyticsRollup({ db, clock, logger });

    const fresh = await computeCohortRollups(
      db,
      {
        environmentId: tenant.environmentId,
        timeZone: PARIS,
        source: 'facts',
        selection: { kind: 'facts', from: '2026-04-02', to: '2026-04-05' },
      },
      'live',
    );
    const stored = await db
      .select()
      .from(analyticsInquiryDaily)
      .where(eq(analyticsInquiryDaily.environmentId, tenant.environmentId));
    const sum = (rows: readonly { day: string; created: number; started: number }[]) => {
      const out = new Map<string, [number, number]>();
      for (const row of rows) {
        const [created, started] = out.get(row.day) ?? [0, 0];
        out.set(row.day, [created + row.created, started + row.started]);
      }
      return [...out].sort();
    };
    expect(sum(stored)).toEqual(sum(fresh.inquiry));
  });
});

/** In each relation of a count's day cells and their total, hidden cells are never one alone. */
function hiddenAlone(cells: readonly unknown[]): boolean {
  return cells.filter((cell) => typeof cell !== 'number').length === 1;
}

describe('complementary suppression on real rollups (C164.7; reviews H18, P21)', () => {
  it('never leaves one hidden day beside the days shown and their total, by day or by week', async () => {
    const clock = fixedClock(NOW);
    const tenant = await seedAnalyticsTenant(db);
    // Week of 2026-03-30: 14, 4, 0, 12, 13, 2, 15 inquiries created a day.
    const perDay = [14, 4, 0, 12, 13, 2, 15];
    for (const [index, count] of perDay.entries()) {
      for (let made = 0; made < count; made += 1) {
        await seedAnalyticsInquiry(db, tenant, {
          createdAt: new Date(Date.UTC(2026, 2, 30 + index, 9, made)),
          status: 'pending',
        });
      }
    }
    await runAnalyticsRollup({ db, clock, logger });
    for (const bucket of ['day', 'week'] as const) {
      const answer = (await readAnalyticsAnswer(
        { db, clock },
        'inquiries',
        { 'filter[from]': '2026-03-30', 'filter[to]': '2026-04-05', bucket },
        { environmentId: tenant.environmentId, mayReadAssignees: false },
      )) as {
        data: {
          attributes: {
            buckets: { counts: Record<string, unknown> }[];
            totals: { counts: Record<string, unknown> };
          };
        };
      };
      const { buckets, totals } = answer.data.attributes;
      for (const key of ['created', 'started']) {
        const cells = [...buckets.map((entry) => entry.counts[key]), totals.counts[key]];
        if (bucket === 'day') {
          expect(hiddenAlone(cells), key).toBe(false);
          expect(cells.filter((cell) => typeof cell !== 'number').length).toBeGreaterThan(0);
        } else {
          expect(buckets[0]?.counts[key]).toEqual(totals.counts[key]);
        }
      }
    }
  });
});

describe('the read plans (C163.4, C164.8)', () => {
  let env = '';
  const since = sql`${NOW.toISOString()}::timestamptz`;

  /** Clones one seeded row of `table` `count` times by SQL, each with its own id and instants. */
  async function clone(
    table: string,
    id: string,
    count: number,
    replace: Record<string, string>,
  ): Promise<void> {
    const columns = (
      await db.execute<{ name: string }>(sql`select column_name as name
        from information_schema.columns where table_name = ${table} order by ordinal_position`)
    ).rows.map((row) => row.name);
    const list = columns.map((column) => `"${column}"`).join(', ');
    const values = columns.map((column) => replace[column] ?? `t."${column}"`).join(', ');
    await db.execute(
      sql.raw(`insert into "${table}" (${list})
        select ${values} from "${table}" t cross join generate_series(1, ${String(count)}) g
        where t.id = '${id}'`),
    );
  }

  beforeAll(async () => {
    const tenant = await seedAnalyticsTenant(db);
    env = tenant.environmentId;
    const inquiry = await finishedOn(tenant, new Date('2026-01-01T09:00:00Z'));
    // 4,000 inquiries over 200 days, each updated on its day, with one attempt and one check each.
    const day = `(timestamptz '2026-01-01 09:00:00+00' + (g % 200) * interval '1 day')`;
    await clone('inquiries', inquiry, 4_000, {
      id: `'inq_' || upper(lpad(to_hex(g), 26, '0'))`,
      created_at: day,
      updated_at: day,
    });
    const [verification] = (
      await db.execute<{ id: string }>(
        sql`select id from verifications where inquiry_id = ${inquiry}`,
      )
    ).rows;
    await clone('verifications', verification?.id ?? '', 4_000, {
      id: `'ver_' || upper(lpad(to_hex(g), 26, '0'))`,
      inquiry_id: `'inq_' || upper(lpad(to_hex(g), 26, '0'))`,
      created_at: day,
      updated_at: day,
    });
    await db.execute(sql`insert into verification_checks (environment_id, verification_id, name,
        status, type, requirement, created_at, updated_at)
      select environment_id, id, 'id_barcode_detection', 'passed', 'fraud', 'required',
        created_at, updated_at
      from verifications where environment_id = ${env} and id like 'ver_0000%'`);
    const template = await seedAnalyticsCaseTemplate(db, tenant);
    const caseId = await seedAnalyticsCase(db, tenant, template, {
      createdAt: new Date('2026-01-01T09:00:00Z'),
    });
    await clone('cases', caseId, 2_000, {
      id: `'case_' || upper(lpad(to_hex(g), 26, '0'))`,
      name: `'${template.key}-' || (g + 1000)::text`,
      created_at: day,
      updated_at: day,
    });
    await db.execute(sql`analyze inquiries`);
    await db.execute(sql`analyze verifications`);
    await db.execute(sql`analyze verification_checks`);
    await db.execute(sql`analyze cases`);
  }, 120_000);

  /** The index names an `explain` of `query` uses. */
  async function indexesOf(query: ReturnType<typeof sql>): Promise<string[]> {
    const result = await db.execute<{ 'QUERY PLAN': unknown }>(sql`explain (format json) ${query}`);
    const plan = JSON.stringify(result.rows);
    return [...plan.matchAll(/"Index Name":"([a-z0-9_]+)"/g)].map((match) => match[1] ?? '');
  }

  it('reads a window of rollup rows through the table’s key', async () => {
    await db.transaction(async (tx) => {
      // The rollup tables are empty here: sequential scans off, the key must serve the range.
      await tx.execute(sql`set local enable_seqscan = off`);
      const result = await tx.execute<{ 'QUERY PLAN': unknown }>(
        sql`explain (format json) select * from analytics_inquiry_daily
          where environment_id = ${env} and day >= '2026-01-01'::date and day <= '2026-04-01'::date`,
      );
      expect(JSON.stringify(result.rows)).toContain('analytics_inquiry_daily_key');
    });
  });

  it('finds dirty days through the updated_at indexes', async () => {
    for (const [table, index] of [
      ['inquiries', 'inquiries_environment_id_updated_at_idx'],
      ['verifications', 'verifications_environment_id_updated_at_idx'],
      ['verification_checks', 'verification_checks_environment_id_updated_at_idx'],
      ['cases', 'cases_environment_id_updated_at_id_idx'],
    ] as const) {
      // A pass's window: the 5 minutes since the last watermark.
      const used = await indexesOf(sql`select created_at from ${sql.identifier(table)}
          where environment_id = ${env} and updated_at > ${since}
            and updated_at <= ${since} + interval '5 minutes'`);
      expect(used, `${table}: ${used.join(', ')}`).toContain(index);
    }
  });

  it('reads a cohort of days through the inquiries’ creation index', async () => {
    const used = await indexesOf(sql`select id from inquiries where environment_id = ${env}
        and created_at >= ${since} and created_at < ${since} + interval '1 day'
        and redacted_at is null`);
    expect(used, used.join(', ')).toContain('inquiries_environment_id_created_at_id_idx');
  });
});
