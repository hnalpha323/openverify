/**
 * C92.5: the network source rows reconciled from the manifest at every startup and first in each
 * CLI: `enabled` from the manifest, less `OPENVERIFY_NETWORK_SOURCES_DISABLED`, plus
 * `OPENVERIFY_NETWORK_SOURCES_ENABLED`; rows the manifest no longer names stay, disabled.
 */
import { listNetworkSourceStates } from '@openverify/db';
import { createTestDatabase, seedNetworkSource, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemClock } from '../ports.js';
import { loadNetworkManifest } from './manifest.js';
import { reconcileNetworkSources } from './reconcile.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.client.query('delete from network_syncs');
  await database.client.query('delete from network_sources');
});

const enabledIds = async () =>
  (await listNetworkSourceStates(database.db))
    .filter((state) => state.enabled)
    .map((state) => state.id);

describe('reconcileNetworkSources', () => {
  it('writes one row per manifest source, enabled by default where the manifest says', async () => {
    const result = await reconcileNetworkSources(database.db, {
      sourcesDisabled: [],
      sourcesEnabled: [],
      clock: systemClock,
    });
    const manifest = loadNetworkManifest();
    expect(result).toEqual({ upserted: manifest.sources.length, disabled: 0 });
    expect(await enabledIds()).toEqual(
      manifest.sources
        .filter((source) => source.enabled_by_default)
        .map((source) => source.id)
        .sort(),
    );
    const sandbox = (await listNetworkSourceStates(database.db)).find(
      (state) => state.id === 'openverify-sandbox-network',
    );
    expect(sandbox).toMatchObject({ enabled: true, sandboxOnly: true });
  });

  it('turns sources off and on from the two lists, and ignores ids the manifest does not name', async () => {
    await reconcileNetworkSources(database.db, {
      sourcesDisabled: ['gcp-cloud', 'aws-ip-ranges', 'not-a-source'],
      sourcesEnabled: ['dbip-city-lite', 'apple-private-relay', 'also-not-a-source'],
      clock: systemClock,
    });
    const enabled = await enabledIds();
    expect(enabled).toContain('dbip-city-lite');
    expect(enabled).toContain('apple-private-relay');
    expect(enabled).not.toContain('gcp-cloud');
    expect(enabled).not.toContain('aws-ip-ranges');
    expect(enabled).not.toContain('azure-service-tags');
    expect((await listNetworkSourceStates(database.db)).map(({ id }) => id)).not.toContain(
      'not-a-source',
    );
  });

  it('lets the disabled list win over the enabled one', async () => {
    await reconcileNetworkSources(database.db, {
      sourcesDisabled: ['dbip-city-lite'],
      sourcesEnabled: ['dbip-city-lite'],
      clock: systemClock,
    });
    expect(await enabledIds()).not.toContain('dbip-city-lite');
  });

  it('keeps a retired source’s row, disabled', async () => {
    await seedNetworkSource(database.db, { id: 'retired-source', enabled: true });
    const result = await reconcileNetworkSources(database.db, {
      sourcesDisabled: [],
      sourcesEnabled: [],
      clock: systemClock,
    });
    expect(result.disabled).toBe(1);
    const retired = (await listNetworkSourceStates(database.db)).find(
      (state) => state.id === 'retired-source',
    );
    expect(retired?.enabled).toBe(false);
  });
});
