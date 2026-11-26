/**
 * C76.4 (V01): the source rows come from the manifest alone: one row per manifest source, enabled
 * by its default less `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`, `sandbox_only` from the manifest;
 * a source the manifest no longer lists keeps its row, disabled. PGlite; synthetic values only.
 */
import { getWatchlistSourceStates, listWatchlistSourceStates } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { watchlistManifest, type WatchlistManifest } from './manifest.js';
import { reconcileWatchlistSources } from './reconcile.js';

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

const flags = async () =>
  Object.fromEntries(
    (await listWatchlistSourceStates(database.db)).map((state) => [
      state.id,
      [state.enabled, state.sandboxOnly],
    ]),
  );

describe('reconcileWatchlistSources (C76.4, V01)', () => {
  it('gives a fresh database one row per manifest source, enabled by its default', async () => {
    const result = await reconcileWatchlistSources(database.db, { disabled: [] });

    expect(result).toEqual({ sources: 8, enabled: 7, retired: 0 });
    expect(await flags()).toEqual({
      'eu-fsf': [true, false],
      'ofac-consolidated': [true, false],
      'ofac-sdn': [true, false],
      'openverify-sandbox': [true, true],
      'openverify-sandbox-pep': [true, true],
      'uk-sanctions-list': [true, false],
      'un-sc': [false, false],
      'wikidata-pep': [true, false],
    });
  });

  it('disables a source the operator lists at the next start, and enables it again after', async () => {
    await reconcileWatchlistSources(database.db, { disabled: [] });

    const disabled = await reconcileWatchlistSources(database.db, { disabled: ['eu-fsf'] });
    expect(disabled.enabled).toBe(6);
    expect((await getWatchlistSourceStates(database.db, ['eu-fsf']))[0]?.enabled).toBe(false);

    await reconcileWatchlistSources(database.db, { disabled: [] });
    expect((await getWatchlistSourceStates(database.db, ['eu-fsf']))[0]?.enabled).toBe(true);
  });

  it('keeps a source the manifest no longer lists, disabled, with its history', async () => {
    await reconcileWatchlistSources(database.db, { disabled: [] });
    await database.db.execute(
      sql`update watchlist_sources set last_checked_at = now() where id = 'uk-sanctions-list'`,
    );
    const manifest: WatchlistManifest = {
      ...watchlistManifest(),
      sources: watchlistManifest().sources.filter((source) => source.id !== 'uk-sanctions-list'),
    };

    const result = await reconcileWatchlistSources(database.db, { disabled: [], manifest });

    expect(result).toEqual({ sources: 7, enabled: 6, retired: 1 });
    const [uk] = await getWatchlistSourceStates(database.db, ['uk-sanctions-list']);
    expect(uk?.enabled).toBe(false);
    expect(uk?.lastCheckedAt).not.toBeNull();
  });

  it('ignores an id in the disabled variable that the manifest does not know', async () => {
    const result = await reconcileWatchlistSources(database.db, { disabled: ['not-a-source'] });

    expect(result.enabled).toBe(7);
    expect(await getWatchlistSourceStates(database.db, ['not-a-source'])).toEqual([]);
  });
});
