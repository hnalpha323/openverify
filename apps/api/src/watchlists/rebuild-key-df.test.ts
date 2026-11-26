/**
 * C270.1 (Workflow 11D, matcher-write-11d): `watchlists:rebuild-key-df`, the full rebuild of a
 * source's key frequencies under its locks, over PGlite with the committed synthetic sandbox list.
 * It keeps the rebuild the sync used before `incremental-key-df`, so an operator can restore a table
 * that is not exact. Its `busy` answer, which needs a second session, is
 * `rebuild-key-df.integration.test.ts`'s.
 */
import { fileURLToPath } from 'node:url';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { FIXTURES_DIRECTORY } from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import {
  WatchlistCliUsageError,
  parseWatchlistsRebuildKeyDfArgs,
  runWatchlistsRebuildKeyDf,
  runWatchlistsSync,
  watchlistRebuildKeyDfExitCode,
  type WatchlistCliRuntime,
} from './cli.js';
import { rebuildWatchlistSourceKeyDf } from './rebuild-key-df.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { sharedWatchlistSession } from './sync.js';

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
const sandboxFile = fileURLToPath(new URL('openverify-sandbox.json', FIXTURES_DIRECTORY));

let database: TestDatabase;
let lines: string[] = [];

function runtime(): WatchlistCliRuntime {
  return {
    db: database.db,
    connect: sharedWatchlistSession(database.db),
    clock: { now: () => new Date('2026-10-27T12:00:00.000Z') },
    logger: silent,
    settings: SETTINGS,
    matcherData: () => ({
      status: 'loaded',
      groups: variantGroupsFrom([], 'a'.repeat(64)),
      keysVersion: keysVersion('a'.repeat(64)),
    }),
    out: (line) => lines.push(line),
  };
}

async function table(): Promise<Record<string, number>> {
  const rows = (
    await database.db.execute(
      sql`select key, count from watchlist_key_df where source_id = ${SOURCE} order by key`,
    )
  ).rows;
  return Object.fromEntries(rows.map((row) => [String(row.key), Number(row.count)]));
}

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

beforeEach(async () => {
  lines = [];
  await database.db.execute(sql`truncate watchlist_sources cascade`);
  await reconcileWatchlistSources(database.db, { disabled: [] });
});

afterAll(async () => {
  await database.close();
});

describe('parseWatchlistsRebuildKeyDfArgs', () => {
  it('rebuilds every source that holds keys, or one, with an optional JSON line', () => {
    expect(parseWatchlistsRebuildKeyDfArgs([])).toEqual({ source: null, json: false });
    expect(parseWatchlistsRebuildKeyDfArgs(['--source=openverify-sandbox', '--json'])).toEqual({
      source: SOURCE,
      json: true,
    });
  });

  it('refuses an unknown flag, a missing value and a malformed id', () => {
    expect(() => parseWatchlistsRebuildKeyDfArgs(['--import', 'list.json'])).toThrow(
      WatchlistCliUsageError,
    );
    expect(() => parseWatchlistsRebuildKeyDfArgs(['--source'])).toThrow(/needs a value/);
    expect(() => parseWatchlistsRebuildKeyDfArgs(['--source', 'Not An Id'])).toThrow(
      /manifest source id/,
    );
  });
});

describe('watchlists:rebuild-key-df (C270.1)', () => {
  it('rebuilds a source’s table in full: a row the rebuild would not write is gone, every row it writes is back', async () => {
    await runWatchlistsSync(
      {
        source: SOURCE,
        importPath: sandboxFile,
        allowMassRemoval: false,
        acceptOlderPublication: false,
        allowNormalised: false,
        json: false,
      },
      runtime(),
    );
    const exact = await table();
    expect(Object.keys(exact).length).toBeGreaterThan(2);
    await database.db.execute(
      sql`insert into watchlist_key_df (source_id, key, count) values (${SOURCE}, 't:synthetic-stale', 7)`,
    );
    await database.db.execute(
      sql`delete from watchlist_key_df where source_id = ${SOURCE} and key = '#names'`,
    );
    lines = [];

    const results = await runWatchlistsRebuildKeyDf({ source: null, json: false }, runtime());

    expect(await table()).toEqual(exact);
    expect(results).toEqual([
      { sourceId: SOURCE, outcome: 'rebuilt', keys: Object.keys(exact).length },
    ]);
    expect(lines).toEqual([`${SOURCE}: rebuilt, ${String(Object.keys(exact).length)} keys`]);
    expect(watchlistRebuildKeyDfExitCode(results)).toBe(0);

    lines = [];
    await runWatchlistsRebuildKeyDf({ source: SOURCE, json: true }, runtime());
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(results);
  });

  it('exits 0 only when every source was rebuilt (a busy source, held by a sync, exits 1)', () => {
    expect(watchlistRebuildKeyDfExitCode([])).toBe(0);
    expect(
      watchlistRebuildKeyDfExitCode([
        { sourceId: SOURCE, outcome: 'rebuilt', keys: 3 },
        { sourceId: 'ofac-sdn', outcome: 'busy', keys: 0 },
      ]),
    ).toBe(1);
  });

  it('refuses a source the manifest does not name', async () => {
    await expect(
      runWatchlistsRebuildKeyDf({ source: 'not-a-source', json: false }, runtime()),
    ).rejects.toThrow(WatchlistCliUsageError);
    await expect(
      rebuildWatchlistSourceKeyDf(
        { db: database.db, connect: sharedWatchlistSession(database.db), logger: silent },
        { sourceId: 'not-a-source' },
      ),
    ).rejects.toThrow(/unknown watchlist source/);
  });
});
