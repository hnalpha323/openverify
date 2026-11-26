/**
 * C270.2 (Workflow 11D, matcher-write-11d): the re-key's batch size, a performance constant
 * (`REKEY_BATCH`, 500) with a measurement override (`rekeyBatch` of the write tunings, Stage 1a
 * amendment 7), over PGlite: every candidate the calibration measures (500, 2,000, 5,000, 10,000)
 * leaves every derived column identical, the override sets the page size, and an interrupted
 * re-key keeps the source's old keys version, so running it again completes it with the same
 * output. Every list is synthetic (the heavy-headed law's fictional names).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getWatchlistSourceStates,
  useWatchlistWriteTuning,
  watchlistWriteTuning,
  type Db,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import {
  heavyHeadedEntries,
  heavyHeadedPool,
  normalisedImport,
  normalisedImportText,
} from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import type { MatcherData } from './matcher-data.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { REKEY_BATCH, rekeyWatchlistSource } from './rekey.js';
import { sharedWatchlistSession, syncWatchlistSource } from './sync.js';

const SOURCE = 'openverify-sandbox';
const ENTRIES = 1_200;
const NOW = new Date('2026-10-27T12:00:00.000Z');
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const matcher = (sha: string, groups: [string, string[]][] = []): MatcherData => ({
  status: 'loaded',
  groups: variantGroupsFrom(groups, sha),
  keysVersion: keysVersion(sha),
});
const KEYED_A = matcher('a'.repeat(64));
/** Keyed with a group over a token the table's names hold, so its keys differ from `KEYED_A`'s. */
let KEYED_B: MatcherData;
const SETTINGS = {
  removedRetentionDays: 90,
  pep: {
    includeRelatives: false,
    openTenureMaxYears: 20,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
} as WatchlistSettings;

let database: TestDatabase;
let files: string;

beforeAll(async () => {
  database = await createTestDatabase();
  files = await mkdtemp(join(tmpdir(), 'openverify-rekey-batch-test-'));
  await reconcileWatchlistSources(database.db, { disabled: [] });
  const pool = heavyHeadedPool('rekey-batch', []);
  const records = [...heavyHeadedEntries({ seed: 'rekey-batch', pool, names: ENTRIES * 4 })].slice(
    0,
    ENTRIES,
  );
  const path = join(files, 'list.json');
  await writeFile(
    path,
    normalisedImportText(normalisedImport(SOURCE, '2026-10-26T00:00:00.000Z', records)),
  );
  const result = await syncWatchlistSource(
    {
      db: database.db,
      connect: sharedWatchlistSession(database.db),
      clock: { now: () => NOW },
      logger,
      settings: SETTINGS,
      matcherData: () => KEYED_A,
    },
    { sourceId: SOURCE, actor: 'seed', importPath: path, allowNormalised: true },
  );
  expect(result.outcome).toBe('applied');
  const [held] = (
    await database.db.execute(
      sql`select k.key from watchlist_names n cross join lateral unnest(n.keys) as k(key)
           where n.source_id = ${SOURCE} and k.key like 't:%' order by k.key limit 1`,
    )
  ).rows;
  const token = String(held?.key).slice(2);
  KEYED_B = matcher('b'.repeat(64), [['synthetic-rekey-group', [token, `${token}zq`]]]);
}, 60_000);

afterAll(async () => {
  await database.close();
  await rm(files, { recursive: true, force: true });
});

/** A handle on the test database that counts its transactions and can fail the n-th. */
function counted(failAt?: number) {
  let transactions = 0;
  const db = new Proxy(database.db, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return (...args: Parameters<TestDatabase['db']['transaction']>) => {
          transactions += 1;
          if (transactions === failAt) {
            throw new Error('synthetic interruption');
          }
          return target.transaction(...args);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as unknown as Db;
  return { db, transactions: () => transactions };
}

/** Re-keys the source with `keyed`, every statement on `db`. */
const rekey = (keyed: MatcherData, db: Db = database.db) =>
  rekeyWatchlistSource(
    {
      db,
      connect: () => Promise.resolve({ db, release: () => Promise.resolve() }),
      clock: { now: () => NOW },
      logger,
      matcherData: () => keyed,
    },
    { sourceId: SOURCE, actor: 'cli' },
  );

/** The SHA-256 of every derived column of the source, in a stable order. */
async function derived(): Promise<string> {
  const hash = createHash('sha256');
  for (const statement of [
    sql`select entry_id, ordinal, name, normalised, script, quality, "primary", keys
          from watchlist_names where source_id = ${SOURCE} order by entry_id collate "C", ordinal`,
    sql`select entry_id, ordinal, kind, value_normalised, country from watchlist_identifiers
         where source_id = ${SOURCE} order by entry_id collate "C", ordinal`,
    sql`select entry_id, ordinal, chain, canonical, raw, ticker from watchlist_crypto_addresses
         where source_id = ${SOURCE} order by entry_id collate "C", ordinal`,
    sql`select key, count from watchlist_key_df where source_id = ${SOURCE} order by key collate "C"`,
  ]) {
    for (const row of (await database.db.execute(statement)).rows) {
      hash.update(`${JSON.stringify(row)}\n`);
    }
  }
  return hash.digest('hex');
}

describe('the re-key’s batch size (C270.2)', () => {
  // Workflow 11D review (fix-11d): the size the calibration chose at 100,000 names (10,000, the
  // fastest median within 2 GiB of heap) and confirmed once at 2,000,000 names against 500
  // (watchlist-phase11.md, method item 8: 2,149.7 s against 2,270.5 s, peak heap 1,446 MiB, every
  // derived column identical).
  it('re-keys 10,000 entries a batch unless the measurement override says otherwise', () => {
    expect(REKEY_BATCH).toBe(10_000);
    expect(watchlistWriteTuning().rekeyBatch).toBeNull();
  });

  it('pages the source by the override, one transaction a page and one to finish', async () => {
    const shipped = counted();
    expect(await rekey(KEYED_B, shipped.db)).toMatchObject({
      outcome: 'rekeyed',
      entries: ENTRIES,
    });
    expect(shipped.transactions()).toBe(Math.ceil(ENTRIES / REKEY_BATCH) + 1);

    // A page smaller than the shipped size (which holds all 1,200 entries), so the override shows.
    onTestFinished(useWatchlistWriteTuning({ rekeyBatch: 500 }));
    const smaller = counted();
    expect(await rekey(KEYED_B, smaller.db)).toMatchObject({
      outcome: 'rekeyed',
      entries: ENTRIES,
    });
    expect(smaller.transactions()).toBe(3 + 1);
  });

  it('leaves every derived column identical for each candidate size', async () => {
    await rekey(KEYED_B);
    const reference = await derived();
    for (const size of [500, 2_000, 5_000, 10_000]) {
      await rekey(KEYED_A);
      expect(await derived()).not.toBe(reference);
      const restore = useWatchlistWriteTuning({ rekeyBatch: size });
      try {
        expect(await rekey(KEYED_B)).toMatchObject({ outcome: 'rekeyed', entries: ENTRIES });
      } finally {
        restore();
      }

      expect(await derived(), String(size)).toBe(reference);
    }
  });

  it('keeps the old keys version when interrupted, and completes with the same output when run again', async () => {
    await rekey(KEYED_B);
    const reference = await derived();
    await rekey(KEYED_A);

    // Pages of 500, so the 1,200 entries take three transactions and the third one fails (the
    // shipped 10,000 holds them all in one page).
    const paged = useWatchlistWriteTuning({ rekeyBatch: 500 });
    try {
      await expect(rekey(KEYED_B, counted(3).db)).rejects.toThrow('synthetic interruption');
    } finally {
      paged();
    }
    const [state] = await getWatchlistSourceStates(database.db, [SOURCE]);
    expect(state?.keysVersion).toBe(keysVersion('a'.repeat(64)));

    expect(await rekey(KEYED_B)).toMatchObject({ outcome: 'rekeyed', entries: ENTRIES });
    expect(await derived()).toBe(reference);
  });
});
