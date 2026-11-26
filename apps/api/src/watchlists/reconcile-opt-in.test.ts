/**
 * C254.1 (Workflow 11B, ingestion-11b; Q10 pending, rule 19): the reconcile and the UN opt-in. Phase
 * 6's rule stands for every caller that names no opt-in source (`enabled` = the manifest's default
 * less `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`), so `un-sc` stays disabled on every start and
 * refresh tick. A caller passes `optInSources` from `optedInWatchlistSources(db, allowed)`, which is
 * empty while the install switch is false: only then, and only for a source that takes an opt-in,
 * does the row follow an environment's recorded acceptance, still less the disabled list. PGlite;
 * synthetic values only.
 */
import { listWatchlistSourceStates } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reconcileWatchlistSources } from './reconcile.js';
import { optedInWatchlistSources } from './un-opt-in.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

beforeEach(async () => {
  await database.db.execute(sql`truncate watchlist_sources cascade`);
});

afterAll(async () => {
  await database.close();
});

const enabled = async (id: string) =>
  (await listWatchlistSourceStates(database.db)).find((state) => state.id === id)?.enabled;

describe('the reconcile and the UN opt-in (C254.1)', () => {
  it('keeps un-sc disabled for a caller that names no opt-in source, as Phase 6 left it', async () => {
    await reconcileWatchlistSources(database.db, { disabled: [] });
    expect(await enabled('un-sc')).toBe(false);
    await reconcileWatchlistSources(database.db, { disabled: [], optInSources: [] });
    expect(await enabled('un-sc')).toBe(false);
  });

  it('names no opt-in source while the switch is false, so the reconcile keeps un-sc disabled', async () => {
    const optInSources = await optedInWatchlistSources(database.db, false);
    expect(optInSources).toEqual([]);
    await reconcileWatchlistSources(database.db, { disabled: [], optInSources });
    expect(await enabled('un-sc')).toBe(false);
  });

  it('enables an opt-in source an environment accepted, unless the install disables it', async () => {
    const result = await reconcileWatchlistSources(database.db, {
      disabled: [],
      optInSources: ['un-sc'],
    });
    expect(result).toEqual({ sources: 8, enabled: 8, retired: 0 });
    expect(await enabled('un-sc')).toBe(true);

    await reconcileWatchlistSources(database.db, { disabled: ['un-sc'], optInSources: ['un-sc'] });
    expect(await enabled('un-sc')).toBe(false);
  });

  it('ignores a source that takes no opt-in', async () => {
    await reconcileWatchlistSources(database.db, {
      disabled: ['ofac-sdn'],
      optInSources: ['ofac-sdn'],
    });
    expect(await enabled('ofac-sdn')).toBe(false);
  });
});
