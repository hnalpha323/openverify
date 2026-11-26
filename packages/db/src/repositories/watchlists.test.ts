/**
 * C76, C74.4: the watchlist sync's writes over PGlite: the source rows and their reconciliation,
 * the audit rows, the sync's writes (upserts, removals, re-listing), the purge, the re-key's pages
 * and the re-screen reads. Every list value is synthetic: fictional names, `SYN-` ids.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing.js';
import { getWatchlistSourceStates } from './watchlist-reads.js';
import {
  countWatchlistSourceContents,
  finishWatchlistSync,
  getWatchlistSync,
  insertWatchlistSync,
  listChangedWatchlistEntries,
  listPendingRescreenSyncs,
  listRecentWatchlistSyncs,
  listWatchlistEntryData,
  listWatchlistSourceStates,
  loadLiveEntryHashes,
  lockWatchlistSourceRow,
  lockWatchlistSourceTransaction,
  markEntriesRemoved,
  markRescreenDone,
  markRescreensEnqueued,
  purgeRemovedWatchlistEntries,
  reconcileWatchlistSourceRows,
  recordWatchlistSourceApplied,
  recordWatchlistSourceCheck,
  recordWatchlistSourceError,
  replaceWatchlistEntryParts,
  setWatchlistSourceKeysVersion,
  tryLockWatchlistSourceSession,
  unlockWatchlistSourceSession,
  writeWatchlistEntries,
} from './watchlists.js';
import {
  HASH,
  LIST,
  NOW,
  OTHER,
  SANDBOX,
  entry,
  insertTestSync,
  resetWatchlists,
} from './watchlists.test-support.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const reset = () => resetWatchlists(database.db);
const sync = (sourceId: string) => insertTestSync(database.db, sourceId);

describe('source rows (C76.4)', () => {
  beforeEach(reset);

  it('reconciles one row per manifest source and retires the rest, disabled, for history', async () => {
    await recordWatchlistSourceCheck(database.db, { sourceId: OTHER, at: NOW });

    const result = await reconcileWatchlistSourceRows(database.db, [
      { id: LIST, enabled: false, sandboxOnly: false },
      { id: SANDBOX, enabled: true, sandboxOnly: true },
    ]);

    expect(result).toEqual({ sources: 2, enabled: 1, retired: 1 });
    const states = await listWatchlistSourceStates(database.db);
    expect(states.map(({ id, enabled, sandboxOnly }) => ({ id, enabled, sandboxOnly }))).toEqual([
      { id: LIST, enabled: false, sandboxOnly: false },
      { id: OTHER, enabled: false, sandboxOnly: false },
      { id: SANDBOX, enabled: true, sandboxOnly: true },
    ]);
    expect(states[1]?.lastCheckedAt).toEqual(NOW);
  });

  it('answers the states of the ids that have a row, and nothing for an unknown one', async () => {
    const states = await getWatchlistSourceStates(database.db, [LIST, 'never-reconciled']);

    expect(states).toEqual([
      {
        id: LIST,
        enabled: true,
        sandboxOnly: false,
        keysVersion: null,
        lastSyncId: null,
        lastPublishedAt: null,
        lastSha256: null,
        lastAppliedAt: null,
        lastCheckedAt: null,
        lastOrigin: null,
        lastErrorCode: null,
        checkFailures: 0,
        lastFailedAt: null,
        // Owner decision 13 after 6B: the scripts of the source's live names (none yet).
        scripts: [],
      },
    ]);
    expect(await getWatchlistSourceStates(database.db, [])).toEqual([]);
  });

  it('records a check, an error, an applied sync and a re-key on the row', async () => {
    await recordWatchlistSourceError(database.db, {
      sourceId: LIST,
      code: 'source_not_configured',
    });
    expect((await getWatchlistSourceStates(database.db, [LIST]))[0]).toMatchObject({
      lastErrorCode: 'source_not_configured',
      checkFailures: 0,
      lastFailedAt: null,
    });
    // K6A-11: a failed check counts toward the back-off; a good check resets it.
    for (const failedAt of [NOW, new Date(NOW.getTime() + 60_000)]) {
      await recordWatchlistSourceError(database.db, {
        sourceId: LIST,
        code: 'download_failed',
        failedAt,
      });
    }
    expect((await getWatchlistSourceStates(database.db, [LIST]))[0]).toMatchObject({
      lastErrorCode: 'download_failed',
      checkFailures: 2,
      lastFailedAt: new Date(NOW.getTime() + 60_000),
    });
    await recordWatchlistSourceCheck(database.db, { sourceId: LIST, at: NOW });
    expect((await getWatchlistSourceStates(database.db, [LIST]))[0]).toMatchObject({
      checkFailures: 0,
      lastFailedAt: null,
    });
    await recordWatchlistSourceError(database.db, {
      sourceId: LIST,
      code: 'download_failed',
      failedAt: NOW,
    });

    const syncId = await sync(LIST);
    await recordWatchlistSourceApplied(database.db, {
      sourceId: LIST,
      syncId,
      publishedAt: new Date('2026-10-26T00:00:00.000Z'),
      sha256: HASH('c'),
      at: NOW,
      origin: 'import',
      keysVersion: 'keys-a',
    });
    await setWatchlistSourceKeysVersion(database.db, { sourceId: LIST, keysVersion: 'keys-b' });

    expect((await getWatchlistSourceStates(database.db, [LIST]))[0]).toMatchObject({
      lastSyncId: syncId,
      lastPublishedAt: new Date('2026-10-26T00:00:00.000Z'),
      lastSha256: HASH('c'),
      lastAppliedAt: NOW,
      lastCheckedAt: NOW,
      lastOrigin: 'import',
      lastErrorCode: null,
      keysVersion: 'keys-b',
      checkFailures: 0,
      lastFailedAt: null,
    });
  });

  it('locks the row inside a transaction and takes the advisory locks', async () => {
    const state = await database.db.transaction(async (tx) => {
      await lockWatchlistSourceTransaction(tx, LIST);
      return lockWatchlistSourceRow(tx, LIST);
    });
    expect(state?.id).toBe(LIST);
    expect(await lockWatchlistSourceRow(database.db, 'never-reconciled')).toBeNull();

    expect(await tryLockWatchlistSourceSession(database.db, LIST)).toBe(true);
    await unlockWatchlistSourceSession(database.db, LIST);
  });
});

describe('audit rows (C73.3)', () => {
  beforeEach(reset);

  it('writes and reads a sync row, numbers for ids, newest first', async () => {
    const first = await insertWatchlistSync(database.db, {
      sourceId: LIST,
      startedAt: new Date('2026-10-27T10:00:00.000Z'),
      finishedAt: new Date('2026-10-27T10:01:00.000Z'),
      outcome: 'refused_mass_removal',
      publishedAt: new Date('2026-10-26T00:00:00.000Z'),
      sha256: HASH('d'),
      entryCount: 10,
      added: 1,
      changed: 2,
      removed: 3,
      actor: 'job',
      origin: 'publisher',
      override: null,
      keysVersion: 'keys-a',
    });
    const second = await insertWatchlistSync(database.db, {
      sourceId: OTHER,
      startedAt: new Date('2026-10-27T11:00:00.000Z'),
      finishedAt: null,
      outcome: 'busy',
      actor: 'cli',
    });

    expect(typeof first).toBe('number');
    expect(await getWatchlistSync(database.db, first)).toEqual({
      id: first,
      sourceId: LIST,
      startedAt: new Date('2026-10-27T10:00:00.000Z'),
      finishedAt: new Date('2026-10-27T10:01:00.000Z'),
      outcome: 'refused_mass_removal',
      publishedAt: new Date('2026-10-26T00:00:00.000Z'),
      sha256: HASH('d'),
      entryCount: 10,
      added: 1,
      changed: 2,
      removed: 3,
      actor: 'job',
      origin: 'publisher',
      override: null,
      keysVersion: 'keys-a',
      rescreenState: 'none',
      rescreenEnqueuedAt: null,
    });
    expect(await getWatchlistSync(database.db, 999_999)).toBeNull();
    expect((await listRecentWatchlistSyncs(database.db, 10)).map(({ id }) => id)).toEqual([
      second,
      first,
    ]);
  });

  it('completes the row an apply transaction inserted first', async () => {
    const id = await insertWatchlistSync(database.db, {
      sourceId: LIST,
      startedAt: NOW,
      finishedAt: null,
      outcome: 'applied',
      actor: 'seed',
      origin: 'import',
      keysVersion: 'keys-a',
    });

    await finishWatchlistSync(database.db, id, {
      finishedAt: new Date('2026-10-27T12:00:05.000Z'),
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      sha256: HASH('9'),
      entryCount: 68,
      added: 68,
      changed: 0,
      removed: 0,
      override: 'allow-normalised',
      rescreenState: 'pending',
    });

    expect(await getWatchlistSync(database.db, id)).toMatchObject({
      outcome: 'applied',
      finishedAt: new Date('2026-10-27T12:00:05.000Z'),
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      sha256: HASH('9'),
      entryCount: 68,
      added: 68,
      override: 'allow-normalised',
      origin: 'import',
      keysVersion: 'keys-a',
      rescreenState: 'pending',
    });
  });

  it('lists the pending re-screens not enqueued lately, and marks them enqueued and done', async () => {
    const pending = await insertWatchlistSync(database.db, {
      sourceId: LIST,
      startedAt: NOW,
      finishedAt: NOW,
      outcome: 'applied',
      actor: 'cli',
      rescreenState: 'pending',
    });
    await insertWatchlistSync(database.db, {
      sourceId: LIST,
      startedAt: NOW,
      finishedAt: NOW,
      outcome: 'applied',
      actor: 'cli',
    });
    const cutoff = new Date(NOW.getTime() - 15 * 60_000);

    expect(
      await listPendingRescreenSyncs(database.db, { enqueuedBefore: cutoff, limit: 10 }),
    ).toEqual([{ id: pending, sourceId: LIST }]);
    await markRescreensEnqueued(database.db, { syncIds: [pending], at: NOW });
    expect(
      await listPendingRescreenSyncs(database.db, { enqueuedBefore: cutoff, limit: 10 }),
    ).toEqual([]);
    expect(
      await listPendingRescreenSyncs(database.db, {
        enqueuedBefore: new Date(NOW.getTime() + 1),
        limit: 10,
      }),
    ).toEqual([{ id: pending, sourceId: LIST }]);
    await markRescreenDone(database.db, pending);
    expect((await getWatchlistSync(database.db, pending))?.rescreenState).toBe('done');
  });
});

describe('the sync’s writes (C76.2 step 6)', () => {
  beforeEach(reset);

  const partsOf = async (entryId: string) => {
    const names = await database.db.execute(
      sql`select name, keys from watchlist_names where source_id = ${LIST} and entry_id = ${entryId} order by ordinal`,
    );
    const identifiers = await database.db.execute(
      sql`select kind, value_normalised from watchlist_identifiers where source_id = ${LIST} and entry_id = ${entryId}`,
    );
    const crypto = await database.db.execute(
      sql`select canonical from watchlist_crypto_addresses where source_id = ${LIST} and entry_id = ${entryId}`,
    );
    return { names: names.rows, identifiers: identifiers.rows, crypto: crypto.rows };
  };
  const entryRow = async (entryId: string) =>
    (
      await database.db.execute(
        sql`select changed_sync_id, last_seen_sync_id, first_seen_sync_id, removed_at, content_hash
              from watchlist_entries where source_id = ${LIST} and entry_id = ${entryId}`,
      )
    ).rows[0];

  it('adds, changes, keeps, removes and lists again, with the sync that changed each entry', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        entry({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery', 't:quill'] }] }),
        entry({
          id: 'SYN-2',
          names: [{ name: 'Rowan Dale', keys: ['t:rowan'] }],
          identifiers: [{ kind: 'passport', value: 'SP1234567', country: 'GB' }],
          crypto: ['0xsynthetic'],
        }),
      ],
    });
    expect(await markEntriesRemoved(database.db, { sourceId: LIST, entryIds: [], at: NOW })).toBe(
      0,
    );
    expect([...(await loadLiveEntryHashes(database.db, LIST)).keys()].sort()).toEqual([
      'SYN-1',
      'SYN-2',
    ]);
    expect(await partsOf('SYN-2')).toEqual({
      names: [{ name: 'Rowan Dale', keys: ['t:rowan'] }],
      identifiers: [{ kind: 'passport', value_normalised: 'SP1234567' }],
      crypto: [{ canonical: '0xsynthetic' }],
    });

    const two = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      entries: [
        entry({ id: 'SYN-1', change: 'unchanged', names: [{ name: 'ignored', keys: [] }] }),
        entry({
          id: 'SYN-2',
          change: 'changed',
          content: 'e',
          names: [{ name: 'Rowan Dalewood', keys: ['t:rowan', 't:dalewood'] }],
        }),
      ],
    });
    // An unchanged entry is not written (evaluation-6): its row keeps the sync that wrote it.
    expect(await entryRow('SYN-1')).toMatchObject({
      changed_sync_id: one,
      last_seen_sync_id: one,
      first_seen_sync_id: one,
    });
    expect(await entryRow('SYN-2')).toMatchObject({
      changed_sync_id: two,
      last_seen_sync_id: two,
      content_hash: HASH('e'),
    });
    expect(await partsOf('SYN-1')).toMatchObject({ names: [{ name: 'Avery Quill' }] });
    expect(await partsOf('SYN-2')).toEqual({
      names: [{ name: 'Rowan Dalewood', keys: ['t:rowan', 't:dalewood'] }],
      identifiers: [],
      crypto: [],
    });

    const three = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: three,
      entries: [entry({ id: 'SYN-1', change: 'unchanged', names: [] })],
    });
    expect(
      await markEntriesRemoved(database.db, {
        sourceId: LIST,
        entryIds: ['SYN-2', 'SYN-NEVER-LISTED'],
        at: NOW,
      }),
    ).toBe(1);
    expect([...(await loadLiveEntryHashes(database.db, LIST)).keys()]).toEqual(['SYN-1']);

    const four = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: four,
      entries: [entry({ id: 'SYN-2', names: [{ name: 'Rowan Dale', keys: ['t:rowan'] }] })],
    });
    expect(await entryRow('SYN-2')).toMatchObject({
      changed_sync_id: four,
      removed_at: null,
      first_seen_sync_id: one,
    });
  });

  it('a risk-data change alone moves changed_sync_id and keeps the derived rows', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [entry({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery'] }] })],
    });
    const two = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      entries: [
        {
          ...entry({ id: 'SYN-1', change: 'changed', risk: 'f', names: [] }),
          contentChanged: false,
          riskDataChanged: true,
        },
      ],
    });

    expect(await entryRow('SYN-1')).toMatchObject({ changed_sync_id: two });
    expect(await partsOf('SYN-1')).toMatchObject({ names: [{ name: 'Avery Quill' }] });
  });

  it('purges entries removed before the cutoff, with their parts, and keeps the rest', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        entry({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery'] }] }),
        entry({ id: 'SYN-2', names: [{ name: 'Rowan Dale', keys: ['t:rowan'] }] }),
      ],
    });
    const two = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      entries: [entry({ id: 'SYN-1', change: 'unchanged', names: [] })],
    });
    await markEntriesRemoved(database.db, {
      sourceId: LIST,
      entryIds: ['SYN-2'],
      at: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(
      await purgeRemovedWatchlistEntries(database.db, {
        before: new Date('2026-06-30T00:00:00.000Z'),
      }),
    ).toBe(0);
    expect(
      await purgeRemovedWatchlistEntries(database.db, {
        before: new Date('2026-07-30T00:00:00.000Z'),
        sourceId: LIST,
      }),
    ).toBe(1);
    expect(await partsOf('SYN-2')).toEqual({ names: [], identifiers: [], crypto: [] });
    expect((await countWatchlistSourceContents(database.db)).get(LIST)).toEqual({
      entries: 1,
      names: 1,
    });
  });

  it('pages the stored records for a re-key and replaces their derived rows', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: ['SYN-1', 'SYN-2', 'SYN-3'].map((id) =>
        entry({ id, names: [{ name: `Name ${id}`, keys: ['t:old'] }] }),
      ),
    });

    const first = await listWatchlistEntryData(database.db, { sourceId: LIST, limit: 2 });
    const rest = await listWatchlistEntryData(database.db, {
      sourceId: LIST,
      afterEntryId: first.at(-1)?.entryId,
      limit: 2,
    });
    expect([...first, ...rest].map(({ entryId }) => entryId)).toEqual(['SYN-1', 'SYN-2', 'SYN-3']);
    expect(first[0]?.data).toEqual({ entry_id: 'SYN-1', synthetic: true });

    await replaceWatchlistEntryParts(database.db, {
      sourceId: LIST,
      entries: [
        {
          entryId: 'SYN-1',
          names: entry({ id: 'SYN-1', names: [{ name: 'Name SYN-1', keys: ['t:new'] }] }).names,
          identifiers: [{ kind: 'lei', value: 'SYNT00000000000000X1', country: null }],
          cryptoAddresses: [],
        },
      ],
    });
    expect(await partsOf('SYN-1')).toEqual({
      names: [{ name: 'Name SYN-1', keys: ['t:new'] }],
      identifiers: [{ kind: 'lei', value_normalised: 'SYNT00000000000000X1' }],
      crypto: [],
    });
  });

  it('lists the live entries a sync added or changed, in pages', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [entry({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery'] }] })],
    });
    const two = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      entries: [
        entry({ id: 'SYN-1', change: 'unchanged', names: [] }),
        entry({ id: 'SYN-2', names: [{ name: 'Rowan Dale', keys: ['t:rowan'] }] }),
        entry({ id: 'SYN-3', names: [{ name: 'Wren Hollow', keys: ['t:wren'] }] }),
      ],
    });

    const page = await listChangedWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      limit: 1,
    });
    const next = await listChangedWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      afterEntryId: 'SYN-2',
      limit: 5,
    });
    expect(page.map(({ entryId }) => entryId)).toEqual(['SYN-2']);
    expect(next.map(({ entryId }) => entryId)).toEqual(['SYN-3']);
    expect(page[0]).toMatchObject({ sourceId: LIST, kind: 'individual', removedAt: null });
  });
});
