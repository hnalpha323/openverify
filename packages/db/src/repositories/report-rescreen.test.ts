/**
 * C74.4, C78.6 (F11, V05), C73.6 (P14): the cross-agent reads and writes `foundation-6` implements:
 * the environments and subjects a re-screen screens, the `list_update` runs it inserts once each,
 * and the reports retention redacts. Synthetic values only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestDatabase,
  createTestTenant,
  seedReport,
  seedReportMatch,
  seedReportRun,
  seedReportTemplate,
  seedWatchlistSource,
  seedWatchlistSync,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  insertListUpdateRuns,
  listRecurringReportSubjects,
  listReportsWithLiveMatches,
  listRescreenEnvironments,
  RESCREEN_CHUNK_LIMIT,
} from './report-rescreen.js';
import { listReportsDueForRetention } from './retention.js';

let database: TestDatabase;
let syncId: number;
const SOURCE = 'synthetic-rescreen';
const OTHER = 'synthetic-other';
const WATCHLIST = { sourceId: SOURCE, reportTypes: ['watchlist'] } as const;

beforeAll(async () => {
  database = await createTestDatabase();
  await seedWatchlistSource(database.db, { id: SOURCE });
  await seedWatchlistSource(database.db, { id: OTHER });
  syncId = await seedWatchlistSync(database.db, { sourceId: SOURCE, rescreenState: 'pending' });
}, 60_000);

afterAll(async () => {
  await database.close();
});

const DAY = 86_400_000;
const NOW = new Date('2026-10-27T12:00:00.000Z');

/** An environment with a template selecting `lists`, and helpers to seed its reports. */
async function environment(kind: 'sandbox' | 'production' = 'sandbox', lists = [SOURCE]) {
  const { environment: env } = await createTestTenant(database.db, { kind });
  const template = await seedReportTemplate(database.db, env.id, {
    config: { 'search-lists': lists },
  });
  const report = (input: Partial<Parameters<typeof seedReport>[2]> = {}) =>
    seedReport(database.db, env.id, { ...template, ...input });
  const recurring = (input: Partial<Parameters<typeof seedReport>[2]> = {}) =>
    report({ recurrenceIntervalDays: 30, nextRunAt: new Date(NOW.getTime() + DAY), ...input });
  return { id: env.id, kind, template, report, recurring };
}

/**
 * Review finding C001: the most parameters one statement bound while `run` ran. Postgres takes at
 * most 65,535 in a Bind message (node-postgres wraps the count beyond that), and PGlite misreads
 * far fewer, so a statement must not bind one parameter per changed entry or per report. The test
 * counts what each statement binds rather than sending more than 65,535 ids through PGlite.
 */
async function mostBoundParameters(run: () => Promise<unknown>): Promise<number> {
  const query = vi.spyOn(database.client, 'query');
  try {
    await run();
    return Math.max(0, ...query.mock.calls.map(([, params]) => params?.length ?? 0));
  } finally {
    query.mockRestore();
  }
}

/** Ids that name no row, enough for several statements' worth of parameters. */
const MANY = 2_500;
/** What one statement may bind, far under both limits above. */
const PARAMETERS_PER_STATEMENT = 1_000;

describe('listRescreenEnvironments and listRecurringReportSubjects (C74.4, C78.6)', () => {
  it('take the recurring, unpaused, unredacted reports of the types whose version selects the source', async () => {
    const env = await environment();
    const due = await env.recurring({ query: { term: 'Avery Synthetic' } });
    await env.report({ query: { term: 'Not recurring' } });
    await env.recurring({ pausedAt: NOW });
    await env.recurring({ query: null, redactedAt: NOW });
    await env.recurring({ reportType: 'politically-exposed-person' });
    const elsewhere = await environment('sandbox', [OTHER]);
    await elsewhere.recurring();

    const environments = await listRescreenEnvironments(database.db, WATCHLIST);
    const subjects = await listRecurringReportSubjects(database.db, env.id, {
      ...WATCHLIST,
      limit: 10,
    });

    expect(environments).toContainEqual({ environmentId: env.id, environmentKind: 'sandbox' });
    expect(environments.map((row) => row.environmentId)).not.toContain(elsewhere.id);
    // Owner decision 3 after 6B: each subject comes with the configuration its version pins, and
    // (decision 4 after 6C) that version's id, so the re-screen resolves each configuration once.
    expect(subjects).toEqual([
      {
        reportId: due,
        reportType: 'watchlist',
        query: { term: 'Avery Synthetic' },
        config: { 'search-lists': [SOURCE] },
        templateVersionId: env.template.versionId,
      },
    ]);
    expect(
      await listRecurringReportSubjects(database.db, elsewhere.id, { ...WATCHLIST, limit: 10 }),
    ).toEqual([]);
  });

  it('pages a chunk at a time by report id, within the environment', async () => {
    const env = await environment('production');
    const ids = [await env.recurring(), await env.recurring(), await env.recurring()].sort();

    const first = await listRecurringReportSubjects(database.db, env.id, {
      ...WATCHLIST,
      limit: 2,
    });
    const rest = await listRecurringReportSubjects(database.db, env.id, {
      ...WATCHLIST,
      limit: 2,
      afterId: first.at(-1)?.reportId,
    });

    expect([...first, ...rest].map((row) => row.reportId)).toEqual(ids);
    expect(await listRescreenEnvironments(database.db, WATCHLIST)).toContainEqual({
      environmentId: env.id,
      environmentKind: 'production',
    });
  });

  it('refuses a chunk over the limit of 50,000 subjects (P09)', async () => {
    const env = await environment();

    await expect(
      listRecurringReportSubjects(database.db, env.id, {
        ...WATCHLIST,
        limit: RESCREEN_CHUNK_LIMIT + 1,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('listReportsWithLiveMatches (owner decision 3 after 6B)', () => {
  it('takes the re-screened reports with an open or delisted match on one of the given entries', async () => {
    const env = await environment();
    const match = async (
      reportId: string,
      status: 'open' | 'dismissed' | 'delisted',
      entryIndex: string,
      sourceId = SOURCE,
    ) => {
      const runId = await seedReportRun(database.db, env.id, { reportId });
      await seedReportMatch(database.db, env.id, { reportId, runId, status, entryIndex, sourceId });
    };
    const open = await env.recurring();
    const delisted = await env.recurring();
    const dismissed = await env.recurring();
    const elsewhere = await env.recurring();
    const oneOff = await env.report();
    const paused = await env.recurring({ pausedAt: NOW });
    const otherSource = await env.recurring();
    await match(open, 'open', 'a1'.repeat(32));
    await match(delisted, 'delisted', 'a2'.repeat(32));
    await match(dismissed, 'dismissed', 'a1'.repeat(32));
    await match(elsewhere, 'open', 'a9'.repeat(32));
    await match(oneOff, 'open', 'a1'.repeat(32));
    await match(paused, 'open', 'a1'.repeat(32));
    await match(otherSource, 'open', 'a1'.repeat(32), OTHER);

    expect(
      await listReportsWithLiveMatches(database.db, env.id, {
        ...WATCHLIST,
        entryIndexes: ['a1'.repeat(32), 'a2'.repeat(32)],
      }),
    ).toEqual([open, delisted].sort());
    // Without the blind-index key: every live match on the source.
    expect(await listReportsWithLiveMatches(database.db, env.id, WATCHLIST)).toEqual(
      [open, delisted, elsewhere].sort(),
    );
    expect(
      await listReportsWithLiveMatches(database.db, env.id, { ...WATCHLIST, entryIndexes: [] }),
    ).toEqual([]);
  });

  it('takes any number of changed entries within a bounded number of parameters per statement (C001)', async () => {
    const env = await environment();
    const first = await env.recurring();
    const last = await env.recurring();
    for (const [reportId, entryIndex] of [
      [first, 'b1'.repeat(32)],
      [last, 'b2'.repeat(32)],
    ] as const) {
      const runId = await seedReportRun(database.db, env.id, { reportId });
      await seedReportMatch(database.db, env.id, {
        reportId,
        runId,
        status: 'open',
        entryIndex,
        sourceId: SOURCE,
      });
    }
    const entryIndexes = [
      'b1'.repeat(32),
      ...Array.from({ length: MANY }, (_, index) => index.toString(16).padStart(64, 'c')),
      'b2'.repeat(32),
      'b1'.repeat(32),
    ];

    let found: string[] = [];
    const bound = await mostBoundParameters(async () => {
      found = await listReportsWithLiveMatches(database.db, env.id, { ...WATCHLIST, entryIndexes });
    });

    expect(found).toEqual([first, last].sort());
    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThanOrEqual(PARAMETERS_PER_STATEMENT);
  });
});

describe('insertListUpdateRuns (C74.4, V05)', () => {
  const runsOf = async (environmentId: string) =>
    (
      await database.db.execute(
        sql`select report_id, run_type, status, trigger_sync_id from report_runs
             where environment_id = ${environmentId} order by report_id`,
      )
    ).rows;

  it('inserts one pending list_update run per report, once, whatever the repeats', async () => {
    const env = await environment();
    const first = await env.recurring();
    const second = await env.recurring();
    const redacted = await env.recurring({ query: null, redactedAt: NOW });
    const other = await environment();
    const foreign = await other.recurring();
    const input = { syncId, reportIds: [first, second, redacted, foreign], at: NOW };

    expect(await insertListUpdateRuns(database.db, env.id, input)).toBe(2);
    expect(await insertListUpdateRuns(database.db, env.id, input)).toBe(0);
    expect(await runsOf(env.id)).toEqual(
      [first, second].sort().map((reportId) => ({
        report_id: reportId,
        run_type: 'list_update',
        status: 'pending',
        trigger_sync_id: syncId,
      })),
    );
    expect(await runsOf(other.id)).toEqual([]);
    expect(await insertListUpdateRuns(database.db, env.id, { ...input, reportIds: [] })).toBe(0);
  });

  it('inserts runs for any number of reports within a bounded number of parameters per statement (C001)', async () => {
    const env = await environment();
    const first = await env.recurring();
    const last = await env.recurring();
    const reportIds = [first, ...Array.from({ length: MANY }, () => testId('rep')), last].sort();

    let inserted = 0;
    const bound = await mostBoundParameters(async () => {
      inserted = await insertListUpdateRuns(database.db, env.id, { syncId, reportIds, at: NOW });
    });

    expect(inserted).toBe(2);
    expect((await runsOf(env.id)).map((row) => row.report_id)).toEqual([first, last].sort());
    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThanOrEqual(PARAMETERS_PER_STATEMENT);
    expect(await insertListUpdateRuns(database.db, env.id, { syncId, reportIds, at: NOW })).toBe(0);
  });
});

describe('listReportsDueForRetention (C73.6, P14)', () => {
  const settings = (environmentId: string, days: number | null) =>
    database.db.execute(
      sql`update environments set settings = settings || ${JSON.stringify({ 'report-retention-days': days })}::jsonb
           where id = ${environmentId}`,
    );

  it('takes the unredacted reports older than report-retention-days, oldest first', async () => {
    const env = await environment();
    await settings(env.id, 30);
    const old = await env.report({ createdAt: new Date(NOW.getTime() - 40 * DAY) });
    const older = await env.report({ createdAt: new Date(NOW.getTime() - 50 * DAY) });
    await env.report({ createdAt: new Date(NOW.getTime() - 10 * DAY) });
    await env.report({
      createdAt: new Date(NOW.getTime() - 60 * DAY),
      query: null,
      redactedAt: NOW,
    });
    const kept = await environment();
    await settings(kept.id, null);
    await kept.report({ createdAt: new Date(NOW.getTime() - 400 * DAY) });
    const unset = await environment();
    await unset.report({ createdAt: new Date(NOW.getTime() - 400 * DAY) });

    const due = await listReportsDueForRetention(database.db, { now: NOW, limit: 100 });

    const mine = due.filter((row) => [env.id, kept.id, unset.id].includes(row.environmentId));
    expect(mine).toEqual([
      { id: older, environmentId: env.id },
      { id: old, environmentId: env.id },
    ]);
  });

  it('honours the batch size and locks in the caller transaction', async () => {
    const env = await environment();
    await settings(env.id, 1);
    await env.report({ createdAt: new Date(NOW.getTime() - 5 * DAY) });
    await env.report({ createdAt: new Date(NOW.getTime() - 6 * DAY) });

    const due = await database.db.transaction((tx) =>
      listReportsDueForRetention(tx, { now: NOW, limit: 1, lock: true }),
    );

    expect(due).toHaveLength(1);
  });
});
