/**
 * C92.2, C92.3 (Workflow 7A, `api-network`): the network sync and the snapshot loader on a real
 * Postgres (Testcontainers, the pinned `pgvector/pgvector:pg17`), each sync on its own pool
 * connection: `busy` while another session holds a source, two syncs racing for one source (one
 * applies, one is busy), the rollback, future and mass-removal guards under the lock, an import
 * recorded as `import`, a source turned off, and a swap while evaluations read. Every publication
 * is synthetic (documentation ranges, fictional ASNs); no publisher is called.
 *
 * C249.3 (Workflow 11B, platform-ops): the syncs and the loader run as the runtime role
 * (`createRuntimeRole`, what `db:grant-runtime` grants), never as the database's owner, and raise
 * no `WARNING`.
 */
import {
  createDatabase,
  getNetworkSync,
  listNetworkSourceStates,
  runMigrations,
  tryLockNetworkSourceSession,
  unlockNetworkSourceSession,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createRuntimeRole,
  ifSet,
  startIntegrationPostgres,
  TEST_RUNTIME_ROLE,
} from '@openverify/db/testing';
import { TorExitSet } from '@openverify/signals/network';
import { sandboxNetworkBundle, syntheticTorExitList } from '@openverify/signals/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryFileStorage } from '../storage/index.js';
import { poolWatchlistSessions } from '../watchlists/sync-session.js';
import { reconcileNetworkSources } from './reconcile.js';
import { createNetworkSnapshots } from './snapshots.js';
import { syncNetworkSource, type NetworkSyncRequest } from './sync.js';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
const storage = createInMemoryFileStorage();
let now = new Date('2026-10-30T08:00:00.000Z');
const clock = { now: () => now };
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

const sync = (request: Omit<NetworkSyncRequest, 'actor'>) =>
  syncNetworkSource(
    { db, connect: poolWatchlistSessions(pool), clock, logger: silent, storage },
    { actor: 'cli', ...request },
  );

const exits = (seed: string, publishedAt: string, relays = 40) =>
  Buffer.from(syntheticTorExitList({ seed, relays, publishedAt: new Date(publishedAt) }));

/** Every `WARNING` the runtime role's connections receive (C249.3: none). */
const warnings: string[] = [];

beforeAll(async () => {
  container = await startIntegrationPostgres();
  const owner = createIntegrationPool(container.getConnectionUri(), { max: 2 });
  try {
    await runMigrations(createDatabase(owner));
  } finally {
    await owner.end();
  }
  pool = createIntegrationPool(await createRuntimeRole(container.getConnectionUri()), { max: 10 });
  pool.on('connect', (client) => {
    client.on('notice', (notice) => {
      if (notice.severity === 'WARNING') {
        warnings.push(notice.message ?? '');
      }
    });
  });
  db = createDatabase(pool);
  await reconcileNetworkSources(db, { sourcesDisabled: [], sourcesEnabled: [], clock });
}, 180_000);

afterAll(async () => {
  await ifSet(pool)?.end();
  await container?.stop();
});

describe('the network sync on its own connections (C92.2)', () => {
  it('ends busy while another session holds the source, and applies once it is released', async () => {
    const list = exits('main', '2026-10-30T06:00:00Z');
    const holder = await pool.connect();
    try {
      const held = createDatabase(holder as unknown as Pool);
      expect(await tryLockNetworkSourceSession(held, 'tor-exit-addresses')).toBe(true);
      const busy = await sync({ sourceId: 'tor-exit-addresses', importBytes: list });
      expect(busy.outcome).toBe('busy');
      expect((await getNetworkSync(db, busy.syncId ?? 0))?.outcome).toBe('busy');
      await unlockNetworkSourceSession(held, 'tor-exit-addresses');
    } finally {
      holder.release();
    }
    expect((await sync({ sourceId: 'tor-exit-addresses', importBytes: list })).outcome).toBe(
      'applied',
    );
  });

  it('applies one of two syncs racing for a source; the other is busy or unchanged', async () => {
    // The same exit relays, published later: neither guard refuses it.
    const list = exits('main', '2026-10-30T07:00:00Z');
    const outcomes = (
      await Promise.all([
        sync({ sourceId: 'tor-exit-addresses', importBytes: list }),
        sync({ sourceId: 'tor-exit-addresses', importBytes: list }),
      ])
    )
      .map((result) => result.outcome)
      .sort();
    expect(outcomes[0]).toBe('applied');
    expect(['busy', 'unchanged']).toContain(outcomes[1]);
  });

  it('refuses an older publication under the lock unless accepted, and records the override', async () => {
    const older = exits('main', '2026-10-29T00:00:00Z');
    expect((await sync({ sourceId: 'tor-exit-addresses', importBytes: older })).outcome).toBe(
      'refused_rollback',
    );
    const accepted = await sync({
      sourceId: 'tor-exit-addresses',
      importBytes: older,
      acceptOlderPublication: true,
    });
    expect(accepted).toMatchObject({ outcome: 'applied', overrides: ['accept-older-publication'] });
    expect((await getNetworkSync(db, accepted.syncId ?? 0))?.overrides).toEqual([
      'accept-older-publication',
    ]);
  });

  it('refuses a publication dated more than a day ahead', async () => {
    const future = exits('future', '2026-11-02T00:00:00Z');
    expect((await sync({ sourceId: 'tor-exit-addresses', importBytes: future })).outcome).toBe(
      'refused_future',
    );
  });

  it('refuses a mass removal under the lock and keeps the applied snapshot', async () => {
    const before = (await listNetworkSourceStates(db)).find(
      (state) => state.id === 'tor-exit-addresses',
    );
    const few = exits('few', '2026-10-30T07:30:00Z', 3);
    expect((await sync({ sourceId: 'tor-exit-addresses', importBytes: few })).outcome).toBe(
      'refused_mass_removal',
    );
    const after = (await listNetworkSourceStates(db)).find(
      (state) => state.id === 'tor-exit-addresses',
    );
    expect(after?.lastSha256).toBe(before?.lastSha256);
    expect(after?.lastErrorCode).toBe('refused_mass_removal');
  });

  it('records an import as import, and refuses a source turned off without a row change', async () => {
    const imported = await sync({
      sourceId: 'openverify-sandbox-network',
      importBytes: sandboxNetworkBundle(),
    });
    expect(imported).toMatchObject({ outcome: 'applied', origin: 'import' });
    expect((await getNetworkSync(db, imported.syncId ?? 0))?.origin).toBe('import');
    const off = await sync({ sourceId: 'dbip-city-lite' });
    expect(off).toMatchObject({ outcome: 'error', errorCode: 'source_disabled' });
  });
});

describe('the snapshot loader against Postgres (C92.3)', () => {
  it('swaps a changed source while evaluations keep reading the old view', async () => {
    const loader = createNetworkSnapshots({ db, storage, clock, logger: silent });
    await loader.start();
    const view = loader.current('production');
    const tor = view.find((snapshot) => snapshot.sourceId === 'tor-exit-addresses');
    expect(tor?.data).toBeInstanceOf(TorExitSet);
    expect(view.some((snapshot) => snapshot.sandboxOnly)).toBe(false);

    now = new Date('2026-10-30T09:00:00.000Z');
    const next = await sync({
      sourceId: 'tor-exit-addresses',
      importBytes: exits('main', '2026-10-30T08:30:00Z'),
      allowMassRemoval: true,
    });
    expect(next.outcome).toBe('applied');
    const reads = Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve(loader.current('production').length)),
    );
    await loader.recheck();
    expect((await reads).every((length) => length === view.length)).toBe(true);
    expect(view.find((snapshot) => snapshot.sourceId === 'tor-exit-addresses')).toBe(tor);
    expect(
      loader.current('production').find((snapshot) => snapshot.sourceId === 'tor-exit-addresses')
        ?.syncId,
    ).toBe(next.syncId);
    await loader.close();
  });
});

describe('as the runtime role (C249.3)', () => {
  it('ran every sync and load above as a non-owner role, with no WARNING', async () => {
    const who = await pool.query<{ name: string; owner: boolean }>(
      `select current_user as name,
              pg_has_role(current_user, (select pg_get_userbyid(datdba) from pg_database
                                          where datname = current_database()), 'member') as owner`,
    );
    expect(who.rows[0]).toEqual({ name: TEST_RUNTIME_ROLE, owner: false });
    expect(warnings).toEqual([]);
  });
});
