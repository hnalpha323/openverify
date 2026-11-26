/**
 * C92.3, C92.4 (H26): the process's network snapshots over PGlite and in-memory object storage,
 * filled by imports of synthetic publications (documentation ranges, fictional ASNs). The loader
 * loads every enabled source's applied snapshot, re-checks its SHA-256, swaps a changed source,
 * and never hands production a sandbox-only source.
 */
import { createHash } from 'node:crypto';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { TorExitSet } from '@openverify/signals/network';
import { sandboxNetworkBundle, syntheticTorExitList } from '@openverify/signals/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../jobs/testing.js';
import type { NetworkSnapshot } from '../ports.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { sharedWatchlistSession } from '../watchlists/sync-session.js';
import { loadNetworkManifest } from './manifest.js';
import { reconcileNetworkSources } from './reconcile.js';
import { createNetworkSnapshots, networkSourceSnapshots } from './snapshots.js';
import { snapshotKey, syncNetworkSource } from './sync.js';

let database: TestDatabase;
const manifest = loadNetworkManifest();
let now = new Date('2026-10-30T08:00:00Z');
const clock = { now: () => now };

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  now = new Date('2026-10-30T08:00:00Z');
  await database.client.query('truncate network_syncs, network_sources');
  await reconcileNetworkSources(database.db, {
    sourcesDisabled: [],
    sourcesEnabled: [],
    clock,
    manifest,
  });
});

function importInto(storage: ReturnType<typeof createInMemoryFileStorage>) {
  return (sourceId: string, importBytes: Uint8Array) =>
    syncNetworkSource(
      {
        db: database.db,
        connect: sharedWatchlistSession(database.db),
        clock,
        logger: createCapturingLogger(),
        storage,
        manifest,
      },
      { sourceId, actor: 'cli', importBytes, allowMassRemoval: true },
    );
}

const tor = (seed: string, hour: number) =>
  Buffer.from(syntheticTorExitList({ seed, publishedAt: new Date(Date.UTC(2026, 9, 30, hour)) }));
const ids = (snapshots: readonly NetworkSnapshot[]) => snapshots.map(({ sourceId }) => sourceId);

describe('an undated publication (R004, C92.2)', () => {
  const CLOUDFLARE = Buffer.from(
    JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result: { ipv4_cidrs: ['192.0.2.0/24'], ipv6_cidrs: [], etag: 'synthetic' },
    }),
  );

  it('is read by the lookup, dated by when it was applied, and shown as such', async () => {
    const storage = createInMemoryFileStorage();
    await importInto(storage)('cloudflare-ips', CLOUDFLARE);
    const loader = createNetworkSnapshots({
      db: database.db,
      storage,
      clock,
      logger: createCapturingLogger(),
      manifest,
    });
    await loader.start();

    const sources = networkSourceSnapshots(
      loader.current('production'),
      'production',
      now,
      manifest,
    );
    await loader.close();

    expect(sources[0]).toMatchObject({
      freshness: 'fresh',
      provenance: { publishedAt: now },
    });
  });

  it('keeps an empty exit list unavailable: no is-tor false from a list with no time', () => {
    const [source] = networkSourceSnapshots(
      [
        {
          sourceId: 'tor-exit-addresses',
          sandboxOnly: false,
          syncId: 1,
          publishedAt: null,
          appliedAt: now,
          sha256: 'a'.repeat(64),
          checkedAt: now,
          bytes: 1,
          data: null,
        },
      ],
      'production',
      now,
      manifest,
    );

    expect(source?.provenance).toBeNull();
  });
});

describe('a frozen exit list (R006, C92.4)', () => {
  const snapshot = (publishedAt: Date, checkedAt: Date): NetworkSnapshot => ({
    sourceId: 'tor-exit-addresses',
    sandboxOnly: false,
    syncId: 1,
    publishedAt,
    appliedAt: publishedAt,
    sha256: 'a'.repeat(64),
    checkedAt,
    bytes: 1,
    data: null,
  });

  it('turns stale by its own publication time, whatever the last check says', () => {
    const hours = (count: number) => new Date(now.getTime() - count * 3_600_000);

    const freshList = networkSourceSnapshots(
      [snapshot(hours(5), now)],
      'production',
      now,
      manifest,
    );
    const frozen = networkSourceSnapshots([snapshot(hours(7), now)], 'production', now, manifest);

    expect(freshList[0]?.freshness).toBe('fresh');
    expect(frozen[0]?.freshness).toBe('stale');
  });
});

describe('a source that could not be loaded (R002)', () => {
  it('is reported, so the lookup reads the gap and never "not listed"', async () => {
    const storage = createInMemoryFileStorage();
    const put = importInto(storage);
    await put('tor-exit-addresses', tor('a', 7));
    await database.client.query(
      "update network_sources set last_sync_id = null, last_sha256 = null where id = 'tor-exit-addresses'",
    );
    const loader = createNetworkSnapshots({
      db: database.db,
      storage,
      clock,
      logger: createCapturingLogger(),
      manifest,
    });
    await loader.start();

    const unloaded = loader.unloaded('production');
    await loader.close();
    const sources = networkSourceSnapshots([], 'production', now, manifest, unloaded);

    expect(unloaded).toContain('tor-exit-addresses');
    expect(unloaded).toContain('aws-ip-ranges');
    expect(unloaded).not.toContain('apple-private-relay');
    expect(unloaded).not.toContain('openverify-sandbox-network');
    expect(sources.find(({ sourceId }) => sourceId === 'aws-ip-ranges')).toMatchObject({
      role: 'cloud-ranges',
      freshness: 'unavailable',
      provenance: null,
      snapshot: null,
    });
  });
});

describe('the stale-source gauge (C250.7, Workflow 11B)', () => {
  it('logs network_sources_stale at each re-check: the public sources stale, never checked or not loaded', async () => {
    const storage = createInMemoryFileStorage();
    await importInto(storage)('tor-exit-addresses', tor('a', 7));
    await importInto(storage)('openverify-sandbox-network', sandboxNetworkBundle());
    const logger = createCapturingLogger();
    const loader = createNetworkSnapshots({ db: database.db, storage, clock, logger, manifest });
    await loader.start();
    const unloaded = loader.unloaded('production').length;
    const gauge = () =>
      logger.entries
        .filter(({ object }) => object.metric === 'network_sources_stale')
        .map(({ object }) => object.value);

    expect(unloaded).toBeGreaterThan(0);
    expect(gauge()).toEqual([unloaded]);

    // The exit list turns stale 6 hours after its last check; the sandbox source never does.
    now = new Date(now.getTime() + 7 * 3_600_000);
    await loader.recheck();
    await loader.close();

    expect(gauge()).toEqual([unloaded, unloaded + 1]);
  });
});

describe('createNetworkSnapshots', () => {
  it('loads each enabled applied source, and gives production no sandbox-only one', async () => {
    const storage = createInMemoryFileStorage();
    const put = importInto(storage);
    const sandbox = await put('openverify-sandbox-network', sandboxNetworkBundle());
    const exits = await put('tor-exit-addresses', tor('a', 7));
    const loader = createNetworkSnapshots({
      db: database.db,
      storage,
      clock,
      logger: createCapturingLogger(),
      manifest,
    });
    expect(loader.current('sandbox')).toEqual([]);
    await loader.start();
    expect(ids(loader.current('sandbox'))).toEqual([
      'openverify-sandbox-network',
      'tor-exit-addresses',
    ]);
    expect(ids(loader.current('production'))).toEqual(['tor-exit-addresses']);
    const [first] = loader.current('production');
    expect(first).toMatchObject({
      sourceId: 'tor-exit-addresses',
      sandboxOnly: false,
      syncId: exits.syncId,
      publishedAt: new Date('2026-10-30T07:00:00Z'),
      checkedAt: now,
      bytes: exits.snapshotBytes,
    });
    expect(first?.data).toBeInstanceOf(TorExitSet);
    expect(loader.current('sandbox')[0]?.syncId).toBe(sandbox.syncId);
    await loader.close();
  });

  it('swaps a source whose applied SHA-256 changed, as a new immutable view', async () => {
    const storage = createInMemoryFileStorage();
    const put = importInto(storage);
    await put('tor-exit-addresses', tor('a', 6));
    const loader = createNetworkSnapshots({
      db: database.db,
      storage,
      clock,
      logger: createCapturingLogger(),
      manifest,
    });
    await loader.start();
    const before = loader.current('production');
    const next = await put('tor-exit-addresses', tor('b', 7));
    now = new Date('2026-10-30T08:05:00Z');
    await loader.recheck();
    const after = loader.current('production');
    expect(after).not.toBe(before);
    expect(before[0]?.syncId).not.toBe(next.syncId);
    expect(after[0]?.syncId).toBe(next.syncId);
    expect(Object.isFrozen(after)).toBe(true);
    await loader.close();
  });

  it('keeps a source’s check time current when an unchanged sync re-checked it', async () => {
    const storage = createInMemoryFileStorage();
    const put = importInto(storage);
    const list = tor('a', 6);
    await put('tor-exit-addresses', list);
    const loader = createNetworkSnapshots({
      db: database.db,
      storage,
      clock,
      logger: createCapturingLogger(),
      manifest,
    });
    await loader.start();
    now = new Date('2026-10-30T09:00:00Z');
    expect((await put('tor-exit-addresses', list)).outcome).toBe('unchanged');
    await loader.recheck();
    expect(loader.current('production')[0]?.checkedAt).toEqual(now);
    await loader.close();
  });

  it('refuses an object whose SHA-256 is not the applied one, keeping what it held', async () => {
    const storage = createInMemoryFileStorage();
    const put = importInto(storage);
    const first = await put('tor-exit-addresses', tor('a', 6));
    const logger = createCapturingLogger();
    const loader = createNetworkSnapshots({ db: database.db, storage, clock, logger, manifest });
    await loader.start();
    const second = await put('tor-exit-addresses', tor('b', 7));
    const rows = await database.client.query<{ sha256: string }>(
      'select sha256 from network_syncs where id = $1',
      [second.syncId],
    );
    await storage.put(
      snapshotKey('tor-exit-addresses', rows.rows[0]?.sha256 ?? ''),
      Buffer.from('tampered'),
    );
    await loader.recheck();
    expect(loader.current('production')[0]?.syncId).toBe(first.syncId);
    expect(logger.entries.some((entry) => entry.message === 'network snapshot not loaded')).toBe(
      true,
    );
    expect(JSON.stringify(logger.entries)).not.toMatch(/192\.0\.2|198\.51\.100|203\.0\.113/);
    await loader.close();
  });

  it('drops a source turned off, and releases everything on close', async () => {
    const storage = createInMemoryFileStorage();
    const put = importInto(storage);
    await put('tor-exit-addresses', tor('a', 6));
    await put('openverify-sandbox-network', sandboxNetworkBundle());
    const loader = createNetworkSnapshots({
      db: database.db,
      storage,
      clock,
      logger: createCapturingLogger(),
      manifest,
      recheckMs: 3_600_000,
    });
    await loader.start();
    await reconcileNetworkSources(database.db, {
      sourcesDisabled: ['tor-exit-addresses'],
      sourcesEnabled: [],
      clock,
      manifest,
    });
    await loader.recheck();
    expect(ids(loader.current('sandbox'))).toEqual(['openverify-sandbox-network']);
    await loader.close();
    expect(loader.current('sandbox')).toEqual([]);
    await loader.close();
  });
});

describe('networkSourceSnapshots (C92.4)', () => {
  const snapshot = (sourceId: string, checkedAt: Date | null, sandboxOnly = false) =>
    ({
      sourceId,
      sandboxOnly,
      syncId: 7,
      publishedAt: new Date('2026-10-30T07:00:00Z'),
      sha256: createHash('sha256').update(sourceId).digest('hex'),
      checkedAt,
      bytes: 10,
      data: null,
    }) satisfies NetworkSnapshot;

  it('gives each snapshot its role, provenance and freshness from its last check', () => {
    const at = new Date('2026-10-30T08:00:00Z');
    const view = networkSourceSnapshots(
      [
        snapshot('tor-exit-addresses', new Date('2026-10-30T02:00:00Z')),
        snapshot('dbip-country-lite', new Date('2026-10-01T00:00:00Z')),
        snapshot('aws-ip-ranges', null),
        snapshot('openverify-sandbox-network', null, true),
        snapshot('retired-source', at),
      ],
      'sandbox',
      at,
      manifest,
    );
    expect(view.map(({ sourceId, role, freshness }) => [sourceId, role, freshness])).toEqual([
      ['tor-exit-addresses', 'tor', 'fresh'],
      ['dbip-country-lite', 'geo-country', 'fresh'],
      ['aws-ip-ranges', 'cloud-ranges', 'unavailable'],
      ['openverify-sandbox-network', 'sandbox', 'fresh'],
    ]);
    expect(view[0]?.provenance).toEqual({
      syncId: '7',
      publishedAt: new Date('2026-10-30T07:00:00Z'),
      sha256: createHash('sha256').update('tor-exit-addresses').digest('hex'),
    });
    const later = networkSourceSnapshots(
      [snapshot('tor-exit-addresses', new Date('2026-10-30T02:00:00Z'))],
      'production',
      new Date('2026-10-30T08:00:01Z'),
      manifest,
    );
    expect(later[0]?.freshness).toBe('stale');
  });

  it('never gives production a sandbox-only source', () => {
    expect(
      networkSourceSnapshots(
        [snapshot('openverify-sandbox-network', null, true)],
        'production',
        new Date(),
        manifest,
      ),
    ).toEqual([]);
  });
});
