/**
 * C78.3 (V04): `watchlists:rekey` for one source over PGlite: every derived column recomputed from
 * the stored records with this version's keys, the version set and a `rekeyed` row written; refused
 * without the filtered variant groups. The sandbox list is the committed synthetic file. Pins
 * written after the code, and seen failing against mutations (see the TDD record).
 */
import { fileURLToPath } from 'node:url';
import { getWatchlistSourceStates, listRecentWatchlistSyncs } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { FIXTURES_DIRECTORY } from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import type { MatcherData } from './matcher-data.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { rekeyWatchlistSource } from './rekey.js';
import { sharedWatchlistSession, syncWatchlistSource } from './sync.js';

let database: TestDatabase;
const NOW = new Date('2026-10-27T12:00:00.000Z');
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const matcher = (sha: string, groups: [string, string[]][] = []): MatcherData => ({
  status: 'loaded',
  groups: variantGroupsFrom(groups, sha),
  keysVersion: keysVersion(sha),
});
const SETTINGS = {
  removedRetentionDays: 90,
  pep: {
    includeRelatives: false,
    openTenureMaxYears: 20,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
} as WatchlistSettings;

beforeAll(async () => {
  database = await createTestDatabase();
  await reconcileWatchlistSources(database.db, { disabled: [] });
  await syncWatchlistSource(
    {
      db: database.db,
      connect: sharedWatchlistSession(database.db),
      clock: { now: () => NOW },
      logger,
      settings: SETTINGS,
      matcherData: () => matcher('a'.repeat(64)),
    },
    {
      sourceId: 'openverify-sandbox',
      actor: 'seed',
      importPath: fileURLToPath(new URL('openverify-sandbox.json', FIXTURES_DIRECTORY)),
    },
  );
}, 60_000);

afterAll(async () => {
  await database.close();
});

const deps = (data: MatcherData) => ({
  db: database.db,
  connect: sharedWatchlistSession(database.db),
  clock: { now: () => NOW },
  logger,
  matcherData: () => data,
});

describe('rekeyWatchlistSource (C78.3, V04)', () => {
  it('refuses without the filtered variant groups and changes nothing', async () => {
    const result = await rekeyWatchlistSource(deps({ status: 'unexpected' }), {
      sourceId: 'openverify-sandbox',
      actor: 'cli',
    });

    expect(result).toMatchObject({ outcome: 'refused_matcher_data', entries: 0 });
    const [state] = await getWatchlistSourceStates(database.db, ['openverify-sandbox']);
    expect(state?.keysVersion).toBe(keysVersion('a'.repeat(64)));
    expect(state?.lastErrorCode).toBe('refused_matcher_data');
  });

  it('recomputes every name’s keys with the new version, and records it', async () => {
    const version = matcher('c'.repeat(64), [['synthetic-rekey-group', ['avery', 'averie']]]);

    const result = await rekeyWatchlistSource(deps(version), {
      sourceId: 'openverify-sandbox',
      actor: 'cli',
    });

    expect(result).toMatchObject({ outcome: 'rekeyed', entries: 69 });
    expect((await listRecentWatchlistSyncs(database.db, 1))[0]).toMatchObject({
      id: result.syncId,
      outcome: 'rekeyed',
      entryCount: 69,
      keysVersion: keysVersion('c'.repeat(64)),
    });
    const [state] = await getWatchlistSourceStates(database.db, ['openverify-sandbox']);
    expect(state?.keysVersion).toBe(keysVersion('c'.repeat(64)));
    const grouped = await database.db.execute(
      sql`select count(*)::int as count from watchlist_names
           where source_id = 'openverify-sandbox' and 'g:synthetic-rekey-group' = any(keys)`,
    );
    expect(grouped.rows[0]?.count).toBeGreaterThan(0);
  });

  it('refuses a source the manifest does not know', async () => {
    await expect(
      rekeyWatchlistSource(deps(matcher('d'.repeat(64))), {
        sourceId: 'not-a-source',
        actor: 'cli',
      }),
    ).rejects.toThrow('unknown watchlist source');
  });
});
