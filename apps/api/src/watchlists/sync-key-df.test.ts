/**
 * C270.1 (Workflow 11D, matcher-write-11d): the sync behind the switch `incremental-key-df`, over
 * PGlite. With the switch on, the sync keeps the key frequencies by the delta of the entries it
 * adds, removes and changes, in its own transaction, instead of rebuilding them; after a seeded
 * sequence of syncs (adds, removals, renames, a variant-group change, re-listings) the table equals
 * a full rebuild's exactly. The switch is off by default (Stage 1a amendment 7). Every list is
 * synthetic (fixtures-6's writers: fictional people, `SYN-` ids), imported from a temporary file.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  rebuildWatchlistKeyDf,
  useWatchlistSwitches,
  watchlistSwitchEnabled,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom, type WatchlistRecord } from '@openverify/watchlist';
import {
  heavyHeadedEntries,
  heavyHeadedPool,
  normalisedImport,
  normalisedImportText,
} from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import type { MatcherData } from './matcher-data.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { sharedWatchlistSession, syncWatchlistSource } from './sync.js';

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

let database: TestDatabase;
let files: string;
let published = Date.parse('2026-10-01T00:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  files = await mkdtemp(join(tmpdir(), 'openverify-sync-key-df-test-'));
}, 60_000);

beforeEach(async () => {
  await database.db.execute(sql`truncate watchlist_sources cascade`);
  await reconcileWatchlistSources(database.db, { disabled: [] });
});

afterAll(async () => {
  await database.close();
  await rm(files, { recursive: true, force: true });
});

/** The fictional names of the heavy-headed law (no raw groups), so many names share tokens. */
const POOL = heavyHeadedPool('sync-key-df', []);

/** The first `count` entries of the heavy-headed table of `seed` (ids by position). */
const list = (seed: string, count: number): WatchlistRecord[] =>
  [...heavyHeadedEntries({ seed, pool: POOL, names: count * 4 })].slice(0, count);

/** Syncs `records` as the source's next publication, keyed by `keyed`. */
async function sync(records: readonly WatchlistRecord[], keyed: MatcherData = MATCHER_A) {
  published += 86_400_000;
  const path = join(files, `list-${String(published)}.json`);
  await writeFile(
    path,
    normalisedImportText(normalisedImport(SOURCE, new Date(published).toISOString(), [...records])),
  );
  return syncWatchlistSource(
    {
      db: database.db,
      connect: sharedWatchlistSession(database.db),
      clock: { now: () => new Date(published + 3_600_000) },
      logger: silent,
      settings: SETTINGS,
      matcherData: () => keyed,
    },
    { sourceId: SOURCE, actor: 'cli', importPath: path, allowNormalised: true },
  );
}

/** The source's table, by key. */
async function table(): Promise<Record<string, number>> {
  const rows = (
    await database.db.execute(
      sql`select key, count from watchlist_key_df where source_id = ${SOURCE} order by key`,
    )
  ).rows;
  return Object.fromEntries(rows.map((row) => [String(row.key), Number(row.count)]));
}

class RollBack extends Error {}

/** What a full rebuild leaves, read inside a transaction that is rolled back. */
async function rebuilt(): Promise<Record<string, number>> {
  let found: Record<string, number> = {};
  await database.db
    .transaction(async (tx) => {
      await rebuildWatchlistKeyDf(tx, SOURCE);
      const rows = (
        await tx.execute(
          sql`select key, count from watchlist_key_df where source_id = ${SOURCE} order by key`,
        )
      ).rows;
      found = Object.fromEntries(rows.map((row) => [String(row.key), Number(row.count)]));
      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) {
        throw error;
      }
    });
  return found;
}

/** `records` with the entries at `positions` taken from `other` (same ids, other names). */
const renamed = (
  records: readonly WatchlistRecord[],
  other: readonly WatchlistRecord[],
  positions: readonly number[],
) =>
  records.map((record, index) => (positions.includes(index) ? (other[index] ?? record) : record));

describe('the sync with the incremental key frequencies (C270.1)', () => {
  // Workflow 11D review (fix-11d): off by default. Kept by rule 5 on a 1,000-entry change, but a
  // large sync (the C78.7 gate's 100,000-name import) ran past its 600 s hook with it on, so it stays
  // off until that is fixed (C271.4).
  it('is off by default (Stage 1a amendment 7; the 11D review)', () => {
    expect(watchlistSwitchEnabled('incremental-key-df')).toBe(false);
  });

  it('leaves the table a full rebuild would leave after every sync of a seeded sequence: adds, removals, renames, a variant-group change, re-listings', async () => {
    onTestFinished(useWatchlistSwitches({ 'incremental-key-df': true }));
    const all = list('key-df-a', 215);
    const first = all.slice(0, 200);
    const others = list('key-df-b', 200);
    const added = all.slice(200);

    const steps: { records: WatchlistRecord[]; keyed?: MatcherData; label: string }[] = [
      { label: 'the first publication', records: first },
      {
        label: 'four removed, six renamed, fifteen added',
        records: [...renamed(first, others, [5, 9, 41, 44, 52, 160]).slice(4), ...added],
      },
      {
        label: 'another variant-group set (a re-key, then the changes), two re-listed',
        keyed: MATCHER_B,
        records: [
          ...first.slice(0, 2),
          ...renamed(first, others, [5, 9, 12, 41, 44, 52, 160, 170]).slice(4, 195),
          ...added,
        ],
      },
      {
        label: 'every rename taken back, one more removed',
        keyed: MATCHER_B,
        records: [...first.slice(0, 2), ...first.slice(4, 194), ...added],
      },
    ];
    for (const step of steps) {
      const result = await sync(step.records, step.keyed);
      expect(result.outcome, step.label).toBe('applied');

      expect(await table(), step.label).toEqual(await rebuilt());
    }
    expect(Object.keys(await table()).length).toBeGreaterThan(100);
  });

  it('applies its delta instead of rebuilding: a row no change reaches is left as it was, which a sync with the switch off rebuilds', async () => {
    const first = list('key-df-stale', 60);
    expect((await sync(first)).outcome).toBe('applied');
    await database.db.execute(
      sql`insert into watchlist_key_df (source_id, key, count) values (${SOURCE}, 't:synthetic-stale', 7)`,
    );

    const on = useWatchlistSwitches({ 'incremental-key-df': true });
    try {
      expect((await sync(first.slice(1))).outcome).toBe('applied');
    } finally {
      on();
    }
    expect(await table()).toMatchObject({ 't:synthetic-stale': 7 });

    const off = useWatchlistSwitches({ 'incremental-key-df': false });
    try {
      expect((await sync(first.slice(2))).outcome).toBe('applied');
    } finally {
      off();
    }
    expect(await table()).not.toHaveProperty('t:synthetic-stale');
    expect(await table()).toEqual(await rebuilt());
  });
});
