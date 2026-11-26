/**
 * C270.3 (Workflow 11D, matcher-write-11d): the two GIN options a sync takes from the write tunings
 * (Stage 1a amendment 7), over PGlite: a lower `gin_pending_list_limit` for the sync's transaction
 * (`ginPendingListLimitKb`) and a clean of the names' pending lists every N written batches
 * (`ginCleanEveryBatches`, through 11B's `openverify_gin_clean_pending_lists`). Both are off by
 * default, and neither changes what the sync writes. The third option, `fastupdate = off`, is index
 * DDL the benchmark applies in its own database. Every list is synthetic.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  rebuildWatchlistKeyDf,
  useWatchlistWriteTuning,
  watchlistWriteTuning,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import { reconcileWatchlistSources } from './reconcile.js';
import {
  GIN_CLEAN_EVERY_BATCHES,
  SYNC_BATCH,
  sharedWatchlistSession,
  syncWatchlistSource,
} from './sync.js';

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
const POOL = heavyHeadedPool('sync-gin', []);

let database: TestDatabase;
let files: string;
let published = Date.parse('2026-10-01T00:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  files = await mkdtemp(join(tmpdir(), 'openverify-sync-gin-test-'));
}, 60_000);

beforeEach(async () => {
  await database.db.execute(sql`truncate watchlist_sources cascade`);
  await reconcileWatchlistSources(database.db, { disabled: [] });
});

afterAll(async () => {
  await database.close();
  await rm(files, { recursive: true, force: true });
});

/** The first `count` entries of a heavy-headed table. */
const list = (count: number): WatchlistRecord[] =>
  [...heavyHeadedEntries({ seed: 'sync-gin', pool: POOL, names: count * 4 })].slice(0, count);

async function sync(records: readonly WatchlistRecord[]) {
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
      matcherData: () => ({
        status: 'loaded',
        groups: variantGroupsFrom([], 'a'.repeat(64)),
        keysVersion: keysVersion('a'.repeat(64)),
      }),
    },
    { sourceId: SOURCE, actor: 'cli', importPath: path, allowNormalised: true },
  );
}

/** The statements sent from now on, inside a transaction or not, by their text and parameters. */
function statements() {
  const sent: { text: string; params: unknown[] }[] = [];
  const client = database.client;
  const record = (text: unknown, params: unknown) => {
    sent.push({ text: String(text), params: Array.isArray(params) ? params : [] });
  };
  const query = client.query.bind(client);
  const transaction = client.transaction.bind(client);
  const direct = vi.spyOn(client, 'query').mockImplementation((text, params, options) => {
    record(text, params);
    return query(text, params, options);
  });
  const wrapped = vi.spyOn(client, 'transaction').mockImplementation((callback) =>
    transaction((tx) => {
      const inner = tx.query.bind(tx);
      tx.query = ((text: string, params?: unknown[], options?: Parameters<typeof inner>[2]) => {
        record(text, params);
        return inner(text, params, options);
      }) as typeof tx.query;
      return callback(tx);
    }),
  );
  onTestFinished(() => {
    direct.mockRestore();
    wrapped.mockRestore();
  });
  return () => sent;
}

const cleans = (sent: { text: string }[]) =>
  sent.filter(({ text }) => text.includes('openverify_gin_clean_pending_lists')).length;

const table = async () =>
  (
    await database.db.execute(
      sql`select key, count from watchlist_key_df where source_id = ${SOURCE} order by key`,
    )
  ).rows;

describe('the GIN options of a sync (C270.3)', () => {
  // Workflow 11D review (fix-11d): the calibration took the clean every 50 written batches
  // (watchlist-phase11.md, method item 9: within twice the idle screening p95 during the
  // 2,000,000-name sync at the lowest sync cost, median 500.3 s against the status quo's 518.4 s), so
  // it is the code's cadence; the tuning stays a measurement override.
  it("cleans the names' pending lists every 50 written batches by default, the option the calibration took", () => {
    expect(GIN_CLEAN_EVERY_BATCHES).toBe(50);
  });

  it('takes no pending-list limit by default, and one clean after the writes of a short sync (owner decision 1 after 6B)', async () => {
    expect(watchlistWriteTuning()).toMatchObject({
      ginPendingListLimitKb: null,
      ginCleanEveryBatches: null,
    });
    const sent = statements();

    expect((await sync(list(SYNC_BATCH * 3))).outcome).toBe('applied');

    expect(sent().some(({ params }) => params.includes('gin_pending_list_limit'))).toBe(false);
    expect(cleans(sent())).toBe(1);
  });

  it('runs the sync’s transaction with the lower pending-list limit, which ends with it', async () => {
    onTestFinished(useWatchlistWriteTuning({ ginPendingListLimitKb: 64 }));
    const sent = statements();

    expect((await sync(list(SYNC_BATCH))).outcome).toBe('applied');

    expect(
      sent().filter(
        ({ text, params }) =>
          text.includes('set_config') && params.includes('gin_pending_list_limit'),
      ),
    ).toEqual([expect.objectContaining({ params: ['gin_pending_list_limit', '64'] })]);
    const [after] = (
      await database.db.execute(sql`select current_setting('gin_pending_list_limit') as limit`)
    ).rows;
    expect(after?.limit).toBe('4MB');
  });

  it('cleans the pending lists every N written batches, and writes the same rows', async () => {
    const records = list(SYNC_BATCH * 4);
    expect((await sync(records.slice(0, SYNC_BATCH))).outcome).toBe('applied');
    const restore = useWatchlistWriteTuning({ ginCleanEveryBatches: 2 });
    onTestFinished(restore);
    const sent = statements();

    // Batch 1 holds only unchanged entries (nothing written); batches 2 to 4 are written.
    expect((await sync(records)).outcome).toBe('applied');

    expect(cleans(sent())).toBe(1 + 1);
    const kept = await table();
    await rebuildWatchlistKeyDf(database.db, SOURCE);
    expect(await table()).toEqual(kept);
  });
});
