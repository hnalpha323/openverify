/**
 * C74.4 (V05), C78.6: the re-screen after a list update, over PGlite with the committed synthetic
 * sandbox lists. For the entries a sync added or changed, the recurring reports of the types that
 * select the source get one `list_update` run each when the reverse index and the forward screen
 * find them; paused and one-off reports are not re-screened; a second run of the job inserts
 * nothing; the sync ends `done`. The sweep's recovery enqueues a pending re-screen again. Every
 * subject is a sandbox magic value or a fictional name.
 */
import { fileURLToPath } from 'node:url';
import { getWatchlistSync, insertWatchlistSync, reportMatchEntryIndex } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedReport,
  seedReportMatch,
  seedReportRun,
  seedReportTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { FIXTURES_DIRECTORY, SANDBOX_WATCHLIST_MAGIC } from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../../config.js';
import type { ReportRescreenJob } from '../../ports.js';
import type { MatcherData } from '../../watchlists/matcher-data.js';
import { reconcileWatchlistSources } from '../../watchlists/reconcile.js';
import { sharedWatchlistSession, syncWatchlistSource } from '../../watchlists/sync.js';
import { processReportRescreen, recoverPendingRescreens } from './rescreen.js';

let database: TestDatabase;
let environmentId: string;
const NOW = new Date('2026-10-27T12:00:00.000Z');
const MATCHER: MatcherData = {
  status: 'loaded',
  groups: variantGroupsFrom([], 'a'.repeat(64)),
  keysVersion: keysVersion('a'.repeat(64)),
};
const SETTINGS = {
  removedRetentionDays: 90,
  pep: {
    includeRelatives: false,
    openTenureMaxYears: 20,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
} as WatchlistSettings;
const logged: string[] = [];
const logger = {
  info: (object: Record<string, unknown>, message: string) =>
    logged.push(JSON.stringify([object, message])),
  warn: (object: Record<string, unknown>, message: string) =>
    logged.push(JSON.stringify([object, message])),
  error: (object: Record<string, unknown>, message: string) =>
    logged.push(JSON.stringify([object, message])),
};
const reports: Record<string, string> = {};

async function importList(name: string): Promise<number> {
  const result = await syncWatchlistSource(
    {
      db: database.db,
      connect: sharedWatchlistSession(database.db),
      clock: { now: () => NOW },
      logger,
      settings: SETTINGS,
      matcherData: () => MATCHER,
    },
    {
      sourceId: 'openverify-sandbox',
      actor: 'seed',
      importPath: fileURLToPath(new URL(name, FIXTURES_DIRECTORY)),
    },
  );
  if (result.syncId === null || result.outcome !== 'applied') {
    throw new Error(`the import of ${name} did not apply`);
  }
  return result.syncId;
}

const KEY = new Uint8Array(32).fill(0x3d);
const deps = (matcherData: () => MatcherData = () => MATCHER, withKey = true) => ({
  db: database.db,
  clock: { now: () => NOW },
  logger,
  watchlists: SETTINGS,
  matcherData,
  blindIndexKey: withKey ? KEY : undefined,
});

async function listUpdateRuns(syncId: number) {
  const rows = await database.db.execute(
    sql`select report_id from report_runs where trigger_sync_id = ${syncId} and run_type = 'list_update'
         order by report_id`,
  );
  return rows.rows.map((row) => String(row.report_id));
}

beforeAll(async () => {
  database = await createTestDatabase();
  await reconcileWatchlistSources(database.db, { disabled: [] });
  ({
    environment: { id: environmentId },
  } = await createTestTenant(database.db));
  const pinned = { 'search-lists': ['openverify-sandbox'] };
  const watchlist = await seedReportTemplate(database.db, environmentId, { config: pinned });
  const business = await seedReportTemplate(database.db, environmentId, {
    reportType: 'business-watchlist',
    config: pinned,
  });
  const crypto = await seedReportTemplate(database.db, environmentId, {
    reportType: 'crypto-address-watchlist',
    config: pinned,
  });
  const other = await seedReportTemplate(database.db, environmentId, {
    config: { 'search-lists': ['ofac-sdn'] },
  });
  const exact = await seedReportTemplate(database.db, environmentId, {
    config: { ...pinned, 'name-matching': { preset: 'exact' } },
  });
  const recurring = { recurrenceIntervalDays: 30, nextRunAt: new Date('2026-11-26T12:00:00.000Z') };
  const magic = SANDBOX_WATCHLIST_MAGIC;
  reports.listed = await seedReport(database.db, environmentId, {
    ...watchlist,
    ...recurring,
    query: { ...magic.listedPerson.query },
  });
  reports.monitored = await seedReport(database.db, environmentId, {
    ...watchlist,
    ...recurring,
    query: { ...magic.monitoredPerson.query },
  });
  reports.unrelated = await seedReport(database.db, environmentId, {
    ...watchlist,
    ...recurring,
    query: { 'name-first': 'Quinby', 'name-last': 'Nobodywright' },
  });
  reports.paused = await seedReport(database.db, environmentId, {
    ...watchlist,
    ...recurring,
    pausedAt: NOW,
    query: { ...magic.monitoredPerson.query },
  });
  reports.oneOff = await seedReport(database.db, environmentId, {
    ...watchlist,
    query: { ...magic.monitoredPerson.query },
  });
  reports.business = await seedReport(database.db, environmentId, {
    ...business,
    ...recurring,
    reportType: 'business-watchlist',
    query: { ...magic.business.query },
  });
  reports.crypto = await seedReport(database.db, environmentId, {
    ...crypto,
    ...recurring,
    reportType: 'crypto-address-watchlist',
    query: { ...magic.cryptoParty.query },
  });
  reports.otherSource = await seedReport(database.db, environmentId, {
    ...other,
    ...recurring,
    query: { ...magic.monitoredPerson.query },
  });
  // Owner decision 3 after 6B: a typo of the listed name under `exact`, which the most permissive
  // screen would match and the report's own preset does not.
  reports.exactTypo = await seedReport(database.db, environmentId, {
    ...exact,
    ...recurring,
    query: {
      'name-first': magic.listedPerson.givenName,
      'name-last': `${magic.listedPerson.familyName.slice(0, -1)}x`,
    },
  });
  // A stranger whose report holds a live match on the monitored entry (C75.8).
  reports.staleHolder = await seedReport(database.db, environmentId, {
    ...watchlist,
    ...recurring,
    query: { 'name-first': 'Quillon', 'name-last': 'Zephyrine' },
  });
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('processReportRescreen (C74.4)', () => {
  let first: number;
  let second: number;

  it('gives each recurring report a hit of the first list one run, and ends the sync done', async () => {
    first = await importList('openverify-sandbox.json');

    const result = await processReportRescreen({ syncId: first }, deps());

    expect(result).toMatchObject({ environments: 1, subjects: 7, runsInserted: 3 });
    expect(await listUpdateRuns(first)).toEqual(
      [reports.listed, reports.business, reports.crypto].sort(),
    );
    expect((await getWatchlistSync(database.db, first))?.rescreenState).toBe('done');
    expect(logged.join('\n')).not.toMatch(/Avery|Rowan|Quillfeather|Fixturedale/);
  });

  it('screens only the entries the next sync added or changed', async () => {
    second = await importList('openverify-sandbox.v2.json');

    const result = await processReportRescreen({ syncId: second }, deps());

    expect(result.runsInserted).toBe(1);
    expect(await listUpdateRuns(second)).toEqual([reports.monitored]);
  });

  it('inserts each run once when the job runs again', async () => {
    await database.db.execute(
      sql`update watchlist_syncs set rescreen_state = 'pending' where id = ${second}`,
    );

    const again = await processReportRescreen({ syncId: second }, deps());

    expect(again.runsInserted).toBe(0);
    expect(await listUpdateRuns(second)).toEqual([reports.monitored]);
    expect((await getWatchlistSync(database.db, second))?.rescreenState).toBe('done');
  });

  it('does nothing for a sync whose re-screen is not pending', async () => {
    expect(await processReportRescreen({ syncId: second }, deps())).toEqual({
      environments: 0,
      subjects: 0,
      runsInserted: 0,
    });
    expect(await processReportRescreen({ syncId: 999_999 }, deps())).toEqual({
      environments: 0,
      subjects: 0,
      runsInserted: 0,
    });
  });

  it('fails without the matcher data and leaves the sync pending for the sweep', async () => {
    await database.db.execute(
      sql`update watchlist_syncs set rescreen_state = 'pending' where id = ${second}`,
    );

    await expect(
      processReportRescreen(
        { syncId: second },
        deps(() => ({ status: 'missing' })),
      ),
    ).rejects.toThrow(/matcher data/);
    expect((await getWatchlistSync(database.db, second))?.rescreenState).toBe('pending');
    await database.db.execute(
      sql`update watchlist_syncs set rescreen_state = 'done' where id = ${second}`,
    );
  });
});

describe('the re-screen of each report at its own preset, and of stale evidence (owner decision 3 after 6B)', () => {
  const entryIndex = (entryId: string) =>
    reportMatchEntryIndex(KEY, { environmentId, entryKey: `openverify-sandbox:${entryId}` });

  it('gives a run to every report with an open or delisted match on a changed entry, whatever its subject', async () => {
    const runId = await seedReportRun(database.db, environmentId, {
      reportId: reports.staleHolder ?? '',
    });
    await seedReportMatch(database.db, environmentId, {
      reportId: reports.staleHolder ?? '',
      runId,
      entryIndex: entryIndex(SANDBOX_WATCHLIST_MAGIC.monitoredPerson.entryId),
    });
    const third = await importList('openverify-sandbox.v3.json');

    const result = await processReportRescreen({ syncId: third }, deps());

    expect(await listUpdateRuns(third)).toEqual([reports.monitored, reports.staleHolder].sort());
    expect(result).toMatchObject({ runsInserted: 2 });
  });

  it('without the blind-index key, gives a run to every report with a live match on the source, and says so', async () => {
    const fourth = await importList('openverify-sandbox.v4.json');
    logged.length = 0;

    await processReportRescreen(
      { syncId: fourth },
      deps(() => MATCHER, false),
    );

    expect(await listUpdateRuns(fourth)).toContain(reports.staleHolder);
    expect(logged.join('\n')).toMatch(/blind-index key/);
  });
});

describe('recoverPendingRescreens (C74.3 (c), V05)', () => {
  it('enqueues each pending re-screen not enqueued in the last 15 minutes, and marks it', async () => {
    await database.db.execute(sql`update watchlist_syncs set rescreen_state = 'done'`);
    const lost = await insertWatchlistSync(database.db, {
      sourceId: 'openverify-sandbox',
      startedAt: NOW,
      finishedAt: NOW,
      outcome: 'applied',
      actor: 'cli',
      rescreenState: 'pending',
    });
    const recent = await insertWatchlistSync(database.db, {
      sourceId: 'openverify-sandbox',
      startedAt: NOW,
      finishedAt: NOW,
      outcome: 'applied',
      actor: 'cli',
      rescreenState: 'pending',
    });
    await database.db.execute(
      sql`update watchlist_syncs set rescreen_enqueued_at = ${new Date(NOW.getTime() - 60_000).toISOString()}::timestamptz
           where id = ${recent}`,
    );
    const enqueued: ReportRescreenJob[] = [];

    const result = await recoverPendingRescreens({
      db: database.db,
      clock: { now: () => NOW },
      logger,
      rescreens: {
        enqueueReportRescreen: (job) => {
          enqueued.push(job);
          return Promise.resolve();
        },
      },
    });

    expect(result).toEqual({ enqueued: 1, failed: 0 });
    expect(enqueued).toEqual([{ syncId: lost }]);
    expect((await getWatchlistSync(database.db, lost))?.rescreenEnqueuedAt).toEqual(NOW);
  });

  it('counts and logs a failed enqueue, and tries it again on the next sweep', async () => {
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const failing = {
      enqueueReportRescreen: () => Promise.reject(new Error('valkey down')),
    };

    const down = await recoverPendingRescreens({
      db: database.db,
      clock: { now: () => later },
      logger,
      rescreens: failing,
    });
    expect(down.failed).toBeGreaterThan(0);
    expect(down.enqueued).toBe(0);
    expect(logged.at(-1)).toMatch(/re-screen not enqueued/);

    const enqueued: ReportRescreenJob[] = [];
    const back = await recoverPendingRescreens({
      db: database.db,
      clock: { now: () => later },
      logger,
      rescreens: {
        enqueueReportRescreen: (job) => {
          enqueued.push(job);
          return Promise.resolve();
        },
      },
    });
    expect(back.enqueued).toBe(down.failed);
    expect(enqueued.length).toBe(down.failed);
  });
});
