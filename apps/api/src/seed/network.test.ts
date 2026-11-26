/**
 * C92.1, C93.6, C92.6: `seed:dev`'s sandbox network data, over PGlite and in-memory storage: the
 * source rows reconciled, the synthetic sandbox bundle imported as a `seed` sync, and a warning
 * when something could not be: no object storage, the sandbox source turned off, or the pinned ASN
 * seeds not fetched. No publisher is called.
 */
import { createHash } from 'node:crypto';
import { listNetworkSourceStates } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sandboxNetworkBundle } from '@openverify/signals/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AsnData } from '../network/asn-data.js';
import { snapshotKey } from '../network/sync.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { fixedClock } from '../test-support/fakes.js';
import { seedNetworkData } from './network.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.client.query('truncate network_syncs, network_sources');
});

const LOADED: () => AsnData = () => ({
  status: 'loaded',
  sets: { hosting: new Set([64503]), vpn: new Set([64500]) },
  counts: { hosting: 1, vpn: 1 },
});
const clock = fixedClock(new Date('2026-10-30T08:00:00Z'));

describe('seedNetworkData', () => {
  it('reconciles the rows and imports the sandbox bundle as a seed sync', async () => {
    const storage = createInMemoryFileStorage();
    const seeded = await seedNetworkData(database.db, {
      sourcesDisabled: [],
      sourcesEnabled: [],
      clock,
      storage,
      asnData: LOADED,
    });
    expect(seeded.warning).toBeNull();
    expect(seeded.sources).toHaveLength(1);
    expect(seeded.sources[0]).toMatchObject({
      sourceId: 'openverify-sandbox-network',
      outcome: 'applied',
    });
    expect(seeded.sources[0]?.entryCount).toBeGreaterThan(0);
    const bundle = sandboxNetworkBundle();
    const digest = createHash('sha256').update(bundle).digest('hex');
    expect(await storage.get(snapshotKey('openverify-sandbox-network', digest))).not.toBeNull();
    expect((await listNetworkSourceStates(database.db)).length).toBe(13);

    // A second seed changes nothing.
    const again = await seedNetworkData(database.db, {
      sourcesDisabled: [],
      sourcesEnabled: [],
      clock,
      storage,
      asnData: LOADED,
    });
    expect(again.sources[0]?.outcome).toBe('unchanged');
  });

  it('imports nothing without object storage, and says why', async () => {
    const seeded = await seedNetworkData(database.db, {
      sourcesDisabled: [],
      sourcesEnabled: [],
      clock,
      asnData: LOADED,
    });
    expect(seeded.sources).toEqual([]);
    expect(seeded.warning).toMatch(/object storage/);
    expect((await listNetworkSourceStates(database.db)).length).toBe(13);
  });

  it('imports nothing when the sandbox source is turned off', async () => {
    const seeded = await seedNetworkData(database.db, {
      sourcesDisabled: ['openverify-sandbox-network'],
      sourcesEnabled: [],
      clock,
      storage: createInMemoryFileStorage(),
      asnData: LOADED,
    });
    expect(seeded.sources).toEqual([]);
    expect(seeded.warning).toMatch(/OPENVERIFY_NETWORK_SOURCES_DISABLED/);
  });

  it('warns, naming fetch_data.py, when the pinned ASN seeds are missing', async () => {
    const seeded = await seedNetworkData(database.db, {
      sourcesDisabled: [],
      sourcesEnabled: [],
      clock,
      storage: createInMemoryFileStorage(),
      asnData: () => ({ status: 'missing', files: ['x4bnet-vpn-ASN.txt'] }),
    });
    expect(seeded.sources[0]?.outcome).toBe('applied');
    expect(seeded.warning).toMatch(/python3 scripts\/fetch_data\.py/);
  });
});
