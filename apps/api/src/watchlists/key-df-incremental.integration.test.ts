/**
 * C270.1 (Workflow 11D, matcher-write-11d): the incremental key frequencies on real Postgres
 * (Testcontainers, `pgvector/pgvector:pg17` with the C73.8 flags), every sync, read and rebuild as
 * the runtime role (C249.3: what `db:grant-runtime` grants, never the owner), with no `WARNING`.
 *
 * - **Identity:** after a seeded sequence of syncs behind `incremental-key-df` (adds, removals,
 *   renames, a variant-group change, re-listings) the table equals a full rebuild's exactly.
 * - **A concurrent re-screen** reads one consistent frequency set (owner decision 4 after 6C): a
 *   whole-table read while a sync applies its delta sees the table before that sync or after it,
 *   never a mix, because the delta commits with the sync's writes.
 * - **Two syncs of one source** stay serialised by the sync's session lock (C76.2, P07): the one
 *   that finds it held answers `busy`, and the table the other leaves is exact. A full rebuild
 *   (`watchlists:rebuild-key-df`) answers `busy` while a sync holds the source.
 *
 * - **The GIN options** (C270.3): the sync's `set_config` of the pending-list limit and its clean
 *   every N written batches through 11B's function both run as the runtime role.
 *
 * Every list is synthetic (the heavy-headed law's fictional names), imported from a temporary file.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabase,
  rebuildWatchlistKeyDf,
  runMigrations,
  tryLockWatchlistSourceSession,
  unlockWatchlistSourceSession,
  useWatchlistSwitches,
  useWatchlistWriteTuning,
  watchlistKeyFrequencyTable,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createRuntimeRole,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom, type WatchlistRecord } from '@openverify/watchlist';
import {
  heavyHeadedEntries,
  heavyHeadedPool,
  normalisedImport,
  normalisedImportText,
} from '@openverify/watchlist/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import type { MatcherData } from './matcher-data.js';
import { rebuildWatchlistSourceKeyDf } from './rebuild-key-df.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { poolWatchlistSessions } from './sync-session.js';
import { syncWatchlistSource } from './sync.js';

const SOURCE = 'openverify-sandbox';
const SETTINGS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: false,
  removedRetentionDays: 90,
  euFsfToken: null,
  wikidataUserAgent: null,
  wikidataSparqlUrl: 'https://query.wikidata.org/sparql',
  pep: {
    openTenureMaxYears: 20,
    includeRelatives: false,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
};
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const matcher = (sha: string, groups: [string, string[]][] = []): MatcherData => ({
  status: 'loaded',
  groups: variantGroupsFrom(groups, sha),
  keysVersion: keysVersion(sha),
});
const MATCHER_A = matcher('a'.repeat(64));
const MATCHER_B = matcher('b'.repeat(64), [['synthetic-group', ['avery', 'averie']]]);
const POOL = heavyHeadedPool('key-df-integration', []);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let files: string;
let published = Date.parse('2026-10-01T00:00:00.000Z');
/** Every `WARNING` the runtime role's connections receive (C249.3: none). */
const warnings: string[] = [];

beforeAll(async () => {
  container = await startIntegrationPostgres();
  const owner = createIntegrationPool(container.getConnectionUri(), { max: 2 });
  try {
    await runMigrations(createDatabase(owner));
  } finally {
    await owner.end();
  }
  pool = createIntegrationPool(await createRuntimeRole(container.getConnectionUri()), { max: 10 });
  pool.on('connect', (client) => {
    client.on('notice', (notice) => {
      if (notice.severity === 'WARNING') {
        warnings.push(notice.message ?? '');
      }
    });
  });
  db = createDatabase(pool);
  files = await mkdtemp(join(tmpdir(), 'openverify-key-df-it-'));
}, 180_000);

beforeEach(async () => {
  // As the runtime role (no TRUNCATE): the source's rows, children first.
  for (const table of [
    'watchlist_key_df',
    'watchlist_names',
    'watchlist_identifiers',
    'watchlist_crypto_addresses',
    'watchlist_entries',
    'watchlist_syncs',
  ]) {
    await db.execute(sql`delete from ${sql.identifier(table)} where source_id = ${SOURCE}`);
  }
  await db.execute(sql`delete from watchlist_sources where id = ${SOURCE}`);
  await reconcileWatchlistSources(db, { disabled: [] });
});

afterAll(async () => {
  await ifSet(pool)?.end();
  await container?.stop();
  await rm(files, { recursive: true, force: true });
});

/** The first `count` entries of the heavy-headed table of `seed` (ids by position). */
const list = (seed: string, count: number): WatchlistRecord[] =>
  [...heavyHeadedEntries({ seed, pool: POOL, names: count * 4 })].slice(0, count);

/** `records` with the entries at `positions` taken from `other` (same ids, other names). */
const renamed = (
  records: readonly WatchlistRecord[],
  other: readonly WatchlistRecord[],
  positions: readonly number[],
) =>
  records.map((record, index) => (positions.includes(index) ? (other[index] ?? record) : record));

/** Writes `records` as the source's next publication; returns its path. */
async function publication(records: readonly WatchlistRecord[]): Promise<string> {
  published += 86_400_000;
  const path = join(files, `list-${String(published)}.json`);
  await writeFile(
    path,
    normalisedImportText(normalisedImport(SOURCE, new Date(published).toISOString(), [...records])),
  );
  return path;
}

/** One sync of the file at `path`, on its own pool connection as the CLIs and the worker run it. */
const sync = (path: string, keyed: MatcherData = MATCHER_A) =>
  syncWatchlistSource(
    {
      db,
      connect: poolWatchlistSessions(pool),
      clock: { now: () => new Date(published + 3_600_000) },
      logger: silent,
      settings: SETTINGS,
      matcherData: () => keyed,
    },
    { sourceId: SOURCE, actor: 'cli', importPath: path, allowNormalised: true },
  );

const asObject = (frequencies: ReadonlyMap<string, number> | null) =>
  Object.fromEntries(
    [...(frequencies ?? new Map<string, number>())].sort(([a], [b]) => (a < b ? -1 : 1)),
  );

/** The source's whole table, read in one statement as the re-screen reads it. */
const table = async () => asObject(await watchlistKeyFrequencyTable(db, SOURCE, 10_000_000));

class RollBack extends Error {}

/** What a full rebuild leaves, read inside a transaction that is rolled back. */
async function rebuilt(): Promise<Record<string, number>> {
  let found: Record<string, number> = {};
  await db
    .transaction(async (tx) => {
      await rebuildWatchlistKeyDf(tx, SOURCE);
      found = asObject(await watchlistKeyFrequencyTable(tx, SOURCE, 10_000_000));
      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) {
        throw error;
      }
    });
  return found;
}

describe('the incremental key frequencies as the runtime role (C270.1, C249.3)', () => {
  it('equals a full rebuild after every sync of a seeded sequence: adds, removals, renames, a variant-group change, re-listings', async () => {
    onTestFinished(useWatchlistSwitches({ 'incremental-key-df': true }));
    const all = list('key-df-it-a', 1_050);
    const first = all.slice(0, 1_000);
    const others = list('key-df-it-b', 1_000);
    const added = all.slice(1_000);
    const renames = Array.from({ length: 40 }, (_, index) => 10 + index * 23);
    const steps: { label: string; records: WatchlistRecord[]; keyed?: MatcherData }[] = [
      { label: 'the first publication', records: first },
      {
        label: '30 removed, 40 renamed, 50 added',
        records: [...renamed(first, others, renames).slice(30), ...added],
      },
      {
        label: 'another variant-group set, 10 re-listed, 20 more removed',
        keyed: MATCHER_B,
        records: [...first.slice(20, 30), ...renamed(first, others, renames).slice(50), ...added],
      },
      {
        label: 'every rename taken back',
        keyed: MATCHER_B,
        records: [...first.slice(20, 30), ...first.slice(50), ...added],
      },
    ];
    for (const step of steps) {
      expect((await sync(await publication(step.records), step.keyed)).outcome, step.label).toBe(
        'applied',
      );

      expect(await table(), step.label).toEqual(await rebuilt());
    }
    expect(Object.keys(await table()).length).toBeGreaterThan(500);
    expect(warnings).toEqual([]);
  });

  it('lets a re-screen read one consistent set while a sync applies its delta: the table before the sync or after it, never a mix', async () => {
    onTestFinished(useWatchlistSwitches({ 'incremental-key-df': true }));
    const all = list('key-df-it-race', 3_200);
    expect((await sync(await publication(all.slice(0, 3_000)))).outcome).toBe('applied');
    const before = await table();
    const next = await publication([...all.slice(150, 3_000), ...all.slice(3_000)]);

    const state = { done: false };
    const reads: Record<string, number>[] = [];
    const running = sync(next).finally(() => {
      state.done = true;
    });
    const finished = () => state.done;
    let duringSync = 0;
    while (!finished()) {
      reads.push(await table());
      duringSync += finished() ? 0 : 1;
    }
    expect((await running).outcome).toBe('applied');
    const after = await table();

    expect(after).not.toEqual(before);
    expect(after).toEqual(await rebuilt());
    expect(duringSync).toBeGreaterThan(0);
    const mixed = reads.filter(
      (read) =>
        JSON.stringify(read) !== JSON.stringify(before) &&
        JSON.stringify(read) !== JSON.stringify(after),
    );
    expect(mixed).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('keeps two syncs of one source serialised: the second finds the source busy, and the table the first leaves is exact', async () => {
    onTestFinished(useWatchlistSwitches({ 'incremental-key-df': true }));
    const all = list('key-df-it-two', 2_200);
    expect((await sync(await publication(all.slice(0, 2_000)))).outcome).toBe('applied');
    const one = await publication([...all.slice(100, 2_000), ...all.slice(2_000, 2_100)]);
    const two = await publication([...all.slice(150, 2_000), ...all.slice(2_100)]);

    const outcomes = (await Promise.all([sync(one), sync(two)])).map((result) => result.outcome);

    expect(outcomes.every((outcome) => outcome === 'applied' || outcome === 'busy')).toBe(true);
    expect(outcomes).toContain('applied');
    expect(await table()).toEqual(await rebuilt());
    expect(warnings).toEqual([]);
  });

  it('takes the GIN options as the runtime role (C270.3): the transaction’s pending-list limit and a clean every N written batches, the table exact, no WARNING', async () => {
    onTestFinished(useWatchlistSwitches({ 'incremental-key-df': true }));
    onTestFinished(useWatchlistWriteTuning({ ginPendingListLimitKb: 64, ginCleanEveryBatches: 1 }));
    const all = list('key-df-it-gin', 1_600);

    expect((await sync(await publication(all.slice(0, 1_500)))).outcome).toBe('applied');
    expect(
      (await sync(await publication([...all.slice(50, 1_500), ...all.slice(1_500)]))).outcome,
    ).toBe('applied');

    expect(await table()).toEqual(await rebuilt());
    expect(warnings).toEqual([]);
  });

  it('answers busy to a full rebuild while a sync holds the source, then rebuilds once it is released', async () => {
    expect((await sync(await publication(list('key-df-it-busy', 200)))).outcome).toBe('applied');
    const holder = await pool.connect();
    const held = createDatabase(holder as unknown as Pool);
    const deps = { db, connect: poolWatchlistSessions(pool), logger: silent };
    try {
      expect(await tryLockWatchlistSourceSession(held, SOURCE)).toBe(true);

      expect(await rebuildWatchlistSourceKeyDf(deps, { sourceId: SOURCE })).toEqual({
        sourceId: SOURCE,
        outcome: 'busy',
        keys: 0,
      });

      await unlockWatchlistSourceSession(held, SOURCE);
    } finally {
      holder.release();
    }
    const exact = await table();
    expect(await rebuildWatchlistSourceKeyDf(deps, { sourceId: SOURCE })).toEqual({
      sourceId: SOURCE,
      outcome: 'rebuilt',
      keys: Object.keys(exact).length,
    });
    expect(await table()).toEqual(exact);
    expect(warnings).toEqual([]);
  });
});
