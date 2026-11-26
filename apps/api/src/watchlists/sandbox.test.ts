/**
 * C76.6, C76.3 (V03), C78.3 (F14): the seed's import of the two synthetic sandbox lists over
 * PGlite. Every subject is a sandbox magic value (fictional); the lists are the committed fixtures.
 */
import {
  getWatchlistSourceStates,
  listRecentWatchlistSyncs,
  retrieveCandidates,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import {
  keysVersion,
  personSubject,
  retrievalQuery,
  variantGroupsFrom,
} from '@openverify/watchlist';
import { SANDBOX_PEP_MAGIC, SANDBOX_WATCHLIST_MAGIC } from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { watchlistSourceAvailability } from './freshness.js';
import type { MatcherData } from './matcher-data.js';
import { manifestSource } from './manifest.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { importSandboxWatchlists, SANDBOX_IMPORT_SKIPPED } from './sandbox.js';
import { sharedWatchlistSession } from './sync.js';

let database: TestDatabase;
const SEEDED = new Date('2026-10-27T12:00:00.000Z');
const HOUR = 3_600_000;
const GROUPS = variantGroupsFrom([], 'a'.repeat(64));
const KEYS = keysVersion('a'.repeat(64));
const MATCHER: MatcherData = { status: 'loaded', groups: GROUPS, keysVersion: KEYS };

const options = (overrides: Partial<Parameters<typeof importSandboxWatchlists>[1]> = {}) => ({
  clock: { now: () => SEEDED },
  disabled: [] as string[],
  matcherData: () => MATCHER,
  connect: sharedWatchlistSession(database.db),
  ...overrides,
});

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

beforeEach(async () => {
  await database.db.execute(sql`truncate watchlist_sources cascade`);
  await reconcileWatchlistSources(database.db, { disabled: [] });
});

afterAll(async () => {
  await database.close();
});

describe('importSandboxWatchlists (C76.6)', () => {
  it('imports both sandbox lists as the seed, recorded as imports, and finds them unchanged the next time', async () => {
    const first = await importSandboxWatchlists(database.db, options());

    expect(first.warning).toBeNull();
    expect(first.lists.map((list) => [list.sourceId, list.outcome, list.entryCount])).toEqual([
      ['openverify-sandbox', 'applied', 69],
      ['openverify-sandbox-pep', 'applied', 62],
    ]);
    const syncs = await listRecentWatchlistSyncs(database.db, 10);
    expect(syncs.map((sync) => [sync.sourceId, sync.actor, sync.origin])).toEqual([
      ['openverify-sandbox-pep', 'seed', 'import'],
      ['openverify-sandbox', 'seed', 'import'],
    ]);

    const again = await importSandboxWatchlists(database.db, options());

    expect(again.lists.map((list) => list.outcome)).toEqual(['unchanged', 'unchanged']);
  });

  it('skips the imports with a warning naming fetch_data.py without the variant groups, writing nothing', async () => {
    const skipped = await importSandboxWatchlists(
      database.db,
      options({ matcherData: () => ({ status: 'missing' }) }),
    );

    expect(skipped).toEqual({ lists: [], warning: SANDBOX_IMPORT_SKIPPED });
    expect(SANDBOX_IMPORT_SKIPPED).toMatch(/python3 scripts\/fetch_data\.py/);
    expect(await listRecentWatchlistSyncs(database.db, 10)).toEqual([]);
  });

  it('does not import a sandbox list the operator disabled', async () => {
    await reconcileWatchlistSources(database.db, { disabled: ['openverify-sandbox-pep'] });

    const imported = await importSandboxWatchlists(
      database.db,
      options({ disabled: ['openverify-sandbox-pep'] }),
    );

    expect(imported.lists.map((list) => list.sourceId)).toEqual(['openverify-sandbox']);
  });

  it('keeps the seeded lists screenable for sandbox reports 72 h and 9 days later, never stale (V03)', async () => {
    await importSandboxWatchlists(database.db, options());
    const states = await getWatchlistSourceStates(database.db, [
      'openverify-sandbox',
      'openverify-sandbox-pep',
    ]);
    const available = (index: number, at: Date, maxListAgeHours: number) =>
      watchlistSourceAvailability({
        source: manifestSource(states[index]?.id ?? ''),
        state: states[index],
        environmentKind: 'sandbox',
        keysVersion: KEYS,
        maxListAgeHours,
        now: at,
      });

    expect(available(0, new Date(SEEDED.getTime() + 72 * HOUR), 48)).toEqual({ screenable: true });
    expect(available(1, new Date(SEEDED.getTime() + 9 * 24 * HOUR), 192)).toEqual({
      screenable: true,
    });
  });

  it('serves a sandbox entry to a sandbox query and none to a production one (P13)', async () => {
    await importSandboxWatchlists(database.db, options());
    const retrieve = (environmentKind: 'sandbox' | 'production', query: Record<string, string>) => {
      const keys = retrievalQuery(personSubject(query), GROUPS);
      return retrieveCandidates(database.db, {
        environmentKind,
        sourceIds: ['openverify-sandbox', 'openverify-sandbox-pep'],
        keys: keys.keys,
        identifiers: keys.identifiers,
        cryptoAddresses: [],
        normalisedName: keys.normalisedNames[0] ?? null,
        cap: 2_000,
      });
    };

    const listed = SANDBOX_WATCHLIST_MAGIC.listedPerson.query;
    const holder = SANDBOX_PEP_MAGIC.headOfGovernment.query;
    expect((await retrieve('sandbox', listed)).candidates.map((found) => found.entryId)).toContain(
      SANDBOX_WATCHLIST_MAGIC.listedPerson.entryId,
    );
    expect((await retrieve('sandbox', holder)).candidates.map((found) => found.entryId)).toContain(
      SANDBOX_PEP_MAGIC.headOfGovernment.entryId,
    );
    expect((await retrieve('production', listed)).candidates).toEqual([]);
    expect((await retrieve('production', holder)).candidates).toEqual([]);
  });
});
