/**
 * The network source and sync rows (plan C92.2-C92.5, Workflow 7A; owner `api-network`): the
 * reconciliation, the locks the sync runner holds, the check, error and apply records, the audit
 * rows and the purge's choice of superseded snapshots. Install-wide public data, never a subject's.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, seedNetworkSource, type TestDatabase } from '../testing.js';
import {
  getNetworkSync,
  insertNetworkSync,
  listNetworkSourceStates,
  listPurgeableNetworkSnapshots,
  listRecentNetworkSyncs,
  lockNetworkSourceRow,
  lockNetworkSourceTransaction,
  markNetworkSnapshotsDeleted,
  reconcileNetworkSourceRows,
  recordNetworkSourceApplied,
  recordNetworkSourceCheck,
  recordNetworkSourceError,
  supersedeNetworkSyncs,
  tryLockNetworkSourceSession,
  unlockNetworkSourceSession,
  type NetworkSyncInput,
} from './network-sources.js';

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

const T = new Date('2026-10-30T08:00:00.000Z');
const minutes = (count: number) => new Date(T.getTime() + count * 60_000);
const sha = (character: string) => character.repeat(64);

function syncInput(overrides: Partial<NetworkSyncInput> = {}): NetworkSyncInput {
  return {
    sourceId: 'tor-exit-addresses',
    startedAt: T,
    finishedAt: T,
    outcome: 'applied',
    errorCode: null,
    publishedAt: T,
    sha256: sha('a'),
    snapshotBytes: 100,
    entryCount: 10,
    coveredIpv4: 10,
    coveredIpv6: '0',
    actor: 'cli',
    origin: 'publisher',
    overrides: [],
    ...overrides,
  };
}

describe('reconcileNetworkSourceRows', () => {
  it('upserts each manifest source and disables the rows the manifest no longer names', async () => {
    await seedNetworkSource(database.db, { id: 'retired-source', enabled: true });
    const result = await reconcileNetworkSourceRows(database.db, [
      { id: 'dbip-country-lite', enabled: true, sandboxOnly: false },
      { id: 'openverify-sandbox-network', enabled: true, sandboxOnly: true },
      { id: 'dbip-city-lite', enabled: false, sandboxOnly: false },
    ]);
    expect(result).toEqual({ upserted: 3, disabled: 1 });
    const states = await listNetworkSourceStates(database.db);
    expect(states.map((state) => [state.id, state.enabled, state.sandboxOnly])).toEqual([
      ['dbip-city-lite', false, false],
      ['dbip-country-lite', true, false],
      ['openverify-sandbox-network', true, true],
      ['retired-source', false, false],
    ]);
    const again = await reconcileNetworkSourceRows(database.db, [
      { id: 'dbip-country-lite', enabled: false, sandboxOnly: false },
    ]);
    expect(again).toEqual({ upserted: 1, disabled: 1 });
    expect((await listNetworkSourceStates(database.db)).every((state) => !state.enabled)).toBe(
      true,
    );
  });

  it('writes nothing for an empty manifest but still disables every row', async () => {
    await seedNetworkSource(database.db, { id: 'tor-exit-addresses', enabled: true });
    expect(await reconcileNetworkSourceRows(database.db, [])).toEqual({ upserted: 0, disabled: 1 });
  });
});

describe('the source locks', () => {
  it('takes the session lock once per source and gives it back', async () => {
    expect(await tryLockNetworkSourceSession(database.db, 'aws-ip-ranges')).toBe(true);
    await unlockNetworkSourceSession(database.db, 'aws-ip-ranges');
    expect(await tryLockNetworkSourceSession(database.db, 'aws-ip-ranges')).toBe(true);
    await unlockNetworkSourceSession(database.db, 'aws-ip-ranges');
  });

  it('locks the row inside a transaction and answers null without one', async () => {
    await seedNetworkSource(database.db, { id: 'aws-ip-ranges' });
    const [row, missing] = await database.db.transaction(async (tx) => {
      await lockNetworkSourceTransaction(tx, 'aws-ip-ranges');
      return [
        await lockNetworkSourceRow(tx, 'aws-ip-ranges'),
        await lockNetworkSourceRow(tx, 'gcp-cloud'),
      ];
    });
    expect(row?.id).toBe('aws-ip-ranges');
    expect(row?.checkFailures).toBe(0);
    expect(missing).toBeNull();
  });
});

describe('the source records', () => {
  it('counts failed checks for the back-off and clears them on a successful check', async () => {
    await seedNetworkSource(database.db, { id: 'tor-exit-addresses' });
    await recordNetworkSourceError(database.db, {
      sourceId: 'tor-exit-addresses',
      code: 'source_not_configured',
    });
    let [state] = await listNetworkSourceStates(database.db);
    expect(state).toMatchObject({ lastErrorCode: 'source_not_configured', checkFailures: 0 });
    await recordNetworkSourceError(database.db, {
      sourceId: 'tor-exit-addresses',
      code: 'download_failed',
      failedAt: minutes(1),
    });
    await recordNetworkSourceError(database.db, {
      sourceId: 'tor-exit-addresses',
      code: 'timeout',
      failedAt: minutes(2),
    });
    [state] = await listNetworkSourceStates(database.db);
    expect(state).toMatchObject({
      lastErrorCode: 'timeout',
      checkFailures: 2,
      lastFailedAt: minutes(2),
    });
    await recordNetworkSourceCheck(database.db, { sourceId: 'tor-exit-addresses', at: minutes(3) });
    [state] = await listNetworkSourceStates(database.db);
    expect(state).toMatchObject({
      lastErrorCode: null,
      checkFailures: 0,
      lastFailedAt: null,
      lastCheckedAt: minutes(3),
    });
  });

  it('records an applied sync as the source’s provenance and check', async () => {
    await seedNetworkSource(database.db, { id: 'tor-exit-addresses' });
    const syncId = await insertNetworkSync(database.db, syncInput());
    await recordNetworkSourceError(database.db, {
      sourceId: 'tor-exit-addresses',
      code: 'timeout',
      failedAt: T,
    });
    await recordNetworkSourceApplied(database.db, {
      sourceId: 'tor-exit-addresses',
      syncId,
      publishedAt: T,
      sha256: sha('a'),
      at: minutes(1),
      origin: 'import',
    });
    const [state] = await listNetworkSourceStates(database.db);
    expect(state).toEqual({
      id: 'tor-exit-addresses',
      enabled: true,
      sandboxOnly: false,
      lastSyncId: syncId,
      lastPublishedAt: T,
      lastSha256: sha('a'),
      lastAppliedAt: minutes(1),
      lastCheckedAt: minutes(1),
      lastOrigin: 'import',
      lastErrorCode: null,
      checkFailures: 0,
      lastFailedAt: null,
    });
  });
});

describe('the sync rows', () => {
  it('writes and reads every column, the IPv6 coverage as a decimal string', async () => {
    await seedNetworkSource(database.db, { id: 'tor-exit-addresses' });
    const id = await insertNetworkSync(
      database.db,
      syncInput({
        coveredIpv6: (2n ** 127n).toString(),
        overrides: ['allow-mass-removal', 'accept-older-publication'],
      }),
    );
    expect(await getNetworkSync(database.db, id)).toEqual({
      id,
      sourceId: 'tor-exit-addresses',
      startedAt: T,
      finishedAt: T,
      outcome: 'applied',
      errorCode: null,
      publishedAt: T,
      sha256: sha('a'),
      snapshotBytes: 100,
      entryCount: 10,
      coveredIpv4: 10,
      coveredIpv6: (2n ** 127n).toString(),
      actor: 'cli',
      origin: 'publisher',
      overrides: ['allow-mass-removal', 'accept-older-publication'],
      supersededAt: null,
      snapshotDeletedAt: null,
    });
    expect(await getNetworkSync(database.db, id + 1000)).toBeNull();
  });

  it('lists the newest syncs first, ties broken by id', async () => {
    await seedNetworkSource(database.db, { id: 'tor-exit-addresses' });
    const first = await insertNetworkSync(database.db, syncInput({ startedAt: T }));
    const second = await insertNetworkSync(
      database.db,
      syncInput({ startedAt: T, outcome: 'busy', sha256: null, origin: null }),
    );
    const third = await insertNetworkSync(database.db, syncInput({ startedAt: minutes(1) }));
    expect((await listRecentNetworkSyncs(database.db, 2)).map((sync) => sync.id)).toEqual([
      third,
      second,
    ]);
    expect((await listRecentNetworkSyncs(database.db, 5)).map((sync) => sync.id)).toEqual([
      third,
      second,
      first,
    ]);
  });
});

describe('the purge of superseded snapshots (C92.3, P27)', () => {
  it('keeps the current and the previous snapshot of each source, and those whose digest they use', async () => {
    await seedNetworkSource(database.db, { id: 'tor-exit-addresses' });
    await seedNetworkSource(database.db, { id: 'aws-ip-ranges' });
    const tor: number[] = [];
    for (const [index, digest] of ['a', 'b', 'c', 'd', 'b'].entries()) {
      const syncId = await insertNetworkSync(
        database.db,
        syncInput({ sha256: sha(digest), startedAt: minutes(index) }),
      );
      await supersedeNetworkSyncs(database.db, {
        sourceId: 'tor-exit-addresses',
        keepSyncId: syncId,
        at: minutes(index),
      });
      tor.push(syncId);
    }
    const refused = await insertNetworkSync(
      database.db,
      syncInput({ outcome: 'refused_mass_removal', sha256: sha('e'), startedAt: minutes(9) }),
    );
    const aws = await insertNetworkSync(
      database.db,
      syncInput({ sourceId: 'aws-ip-ranges', sha256: sha('a') }),
    );
    // Only the earlier applied syncs of the source are superseded, never another source's.
    const rows = await Promise.all(
      [...tor, refused, aws].map((id) => getNetworkSync(database.db, id)),
    );
    expect(rows.map((row) => row?.supersededAt ?? null)).toEqual([
      minutes(1),
      minutes(2),
      minutes(3),
      minutes(4),
      null,
      null,
      null,
    ]);
    // Current: tor[4] (b). Previous: tor[3] (d). tor[1] shares b, so it stays too.
    const purgeable = await listPurgeableNetworkSnapshots(database.db, {
      supersededBefore: minutes(100),
      limit: 10,
    });
    expect(purgeable).toEqual([
      { syncId: tor[0], sourceId: 'tor-exit-addresses', sha256: sha('a') },
      { syncId: tor[2], sourceId: 'tor-exit-addresses', sha256: sha('c') },
    ]);
    expect(
      await listPurgeableNetworkSnapshots(database.db, { supersededBefore: minutes(2), limit: 10 }),
    ).toEqual([{ syncId: tor[0], sourceId: 'tor-exit-addresses', sha256: sha('a') }]);
    expect(
      await listPurgeableNetworkSnapshots(database.db, {
        supersededBefore: minutes(100),
        limit: 1,
      }),
    ).toHaveLength(1);
    await markNetworkSnapshotsDeleted(database.db, { syncIds: [tor[0] ?? 0], at: minutes(200) });
    expect((await getNetworkSync(database.db, tor[0] ?? 0))?.snapshotDeletedAt).toEqual(
      minutes(200),
    );
    expect(
      await listPurgeableNetworkSnapshots(database.db, {
        supersededBefore: minutes(100),
        limit: 10,
      }),
    ).toEqual([{ syncId: tor[2], sourceId: 'tor-exit-addresses', sha256: sha('c') }]);
    await markNetworkSnapshotsDeleted(database.db, { syncIds: [], at: minutes(200) });
  });
});
