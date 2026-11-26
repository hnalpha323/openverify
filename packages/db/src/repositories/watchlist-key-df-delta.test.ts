/**
 * C270.1 (Workflow 11D, matcher-write-11d): the key frequencies kept by the delta of a sync's
 * writes, over PGlite. After any sequence of adds, removals, renames, re-listings and risk-only
 * changes the table must equal a full rebuild's exactly (`rebuildWatchlistKeyDf`'s rules: a name
 * key counts the live entries whose strong names hold it and has no row below 2; `#names` counts the
 * live strong names and `#script:<script>` the live names of each script, each with a row from 1).
 * Every list value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing.js';
import {
  applyWatchlistKeyDfDelta,
  cleanWatchlistGinPendingLists,
  countWatchlistKeyDfRows,
  rebuildWatchlistKeyDf,
  setWatchlistGinPendingListLimit,
  trackWatchlistKeyDf,
  watchlistKeyDfShares,
  WATCHLIST_NAME_COUNT_KEY,
  WATCHLIST_SCRIPT_KEY_PREFIX,
  type WatchlistKeyDfShare,
} from './watchlist-key-df.js';
import {
  markEntriesRemoved,
  writeWatchlistEntries,
  type WatchlistEntryWrite,
} from './watchlists.js';
import {
  LIST,
  NOW,
  OTHER,
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

beforeEach(() => resetWatchlists(database.db));

const SCRIPT = (script: string) => `${WATCHLIST_SCRIPT_KEY_PREFIX}${script}`;

/** The source's table, by key. */
async function table(sourceId = LIST): Promise<Record<string, number>> {
  const rows = (
    await database.db.execute(
      sql`select key, count from watchlist_key_df where source_id = ${sourceId} order by key`,
    )
  ).rows;
  return Object.fromEntries(rows.map((row) => [String(row.key), Number(row.count)]));
}

/** What a full rebuild leaves, read inside a transaction that is rolled back. */
async function rebuilt(sourceId = LIST): Promise<Record<string, number>> {
  let found: Record<string, number> = {};
  await database.db
    .transaction(async (tx) => {
      await rebuildWatchlistKeyDf(tx, sourceId);
      const rows = (
        await tx.execute(
          sql`select key, count from watchlist_key_df where source_id = ${sourceId} order by key`,
        )
      ).rows;
      found = Object.fromEntries(rows.map((row) => [String(row.key), Number(row.count)]));
      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) {
        throw error;
      }
    });
  return found;
}

class RollBack extends Error {}

/** An entry whose names are written in the given scripts (the shared helper writes only latin). */
function scripted(
  spec: Parameters<typeof entry>[0],
  scripts: readonly string[] = [],
): WatchlistEntryWrite {
  const written = entry(spec);
  return {
    ...written,
    names: written.names.map((name, index) => ({ ...name, script: scripts[index] ?? 'latin' })),
  };
}

const shares = (entries: Record<string, WatchlistKeyDfShare>) => new Map(Object.entries(entries));

describe('the shares of some entries (C270.1)', () => {
  it('counts each key once per live entry over strong names, and the reserved counts over names, as the rebuild does', async () => {
    const one = await insertTestSync(database.db, LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        scripted(
          {
            id: 'SYN-1',
            names: [
              { name: 'Avery Quill', keys: ['t:avery', 't:quill'] },
              { name: 'Quill Avery', keys: ['t:avery', 't:quill'] },
              { name: 'Avy', keys: ['t:avy'], quality: 'weak' },
            ],
          },
          ['latin', 'latin', 'cyrillic'],
        ),
        scripted({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery', 't:dale'] }] }),
        scripted({ id: 'SYN-3', names: [{ name: 'Rowan Dale', keys: ['t:rowan', 't:dale'] }] }),
      ],
    });
    await markEntriesRemoved(database.db, { sourceId: LIST, entryIds: ['SYN-3'], at: NOW });
    const other = await insertTestSync(database.db, OTHER);
    await writeWatchlistEntries(database.db, {
      sourceId: OTHER,
      syncId: other,
      entries: [scripted({ id: 'SYN-1', names: [{ name: 'Elsewhere', keys: ['t:avery'] }] })],
    });

    const found = await watchlistKeyDfShares(database.db, LIST, ['SYN-1', 'SYN-2', 'SYN-3']);

    expect(Object.fromEntries(found)).toEqual({
      't:avery': { reserved: false, count: 2 },
      't:quill': { reserved: false, count: 1 },
      't:dale': { reserved: false, count: 1 },
      [WATCHLIST_NAME_COUNT_KEY]: { reserved: true, count: 3 },
      [SCRIPT('latin')]: { reserved: true, count: 3 },
      [SCRIPT('cyrillic')]: { reserved: true, count: 1 },
    });
    expect(await watchlistKeyDfShares(database.db, LIST, [])).toEqual(new Map());

    await rebuildWatchlistKeyDf(database.db, LIST);
    expect(await countWatchlistKeyDfRows(database.db, LIST)).toBe(
      Object.keys(await table()).length,
    );
    expect(await countWatchlistKeyDfRows(database.db, 'synthetic-empty-list')).toBe(0);
  });
});

describe('a delta applied to the table (C270.1)', () => {
  it('adds a key’s row when its count reaches 2, deletes it below 2, and keeps the reserved rows from 1', async () => {
    const one = await insertTestSync(database.db, LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        scripted({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery', 't:quill'] }] }),
        scripted({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery', 't:dale'] }] }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);
    expect(await table()).toEqual({
      [WATCHLIST_NAME_COUNT_KEY]: 2,
      [SCRIPT('latin')]: 2,
      't:avery': 2,
    });

    // SYN-2 leaves (t:avery 2 -> 1: its row goes; t:dale stays at 1 with SYN-3's); SYN-3 arrives
    // in another script holding t:quill (1 -> 2: a row) and t:dale.
    const before = await watchlistKeyDfShares(database.db, LIST, ['SYN-2', 'SYN-3']);
    await markEntriesRemoved(database.db, { sourceId: LIST, entryIds: ['SYN-2'], at: NOW });
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        scripted({ id: 'SYN-3', names: [{ name: 'Квилл Дейл', keys: ['t:quill', 't:dale'] }] }, [
          'cyrillic',
        ]),
      ],
    });
    const after = await watchlistKeyDfShares(database.db, LIST, ['SYN-2', 'SYN-3']);
    const delta = new Map<string, WatchlistKeyDfShare>();
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const reserved = (after.get(key) ?? before.get(key))?.reserved ?? false;
      delta.set(key, {
        reserved,
        count: (after.get(key)?.count ?? 0) - (before.get(key)?.count ?? 0),
      });
    }

    await applyWatchlistKeyDfDelta(database.db, LIST, delta);

    expect(await table()).toEqual(await rebuilt());
    expect(await table()).toEqual({
      [WATCHLIST_NAME_COUNT_KEY]: 2,
      [SCRIPT('latin')]: 1,
      [SCRIPT('cyrillic')]: 1,
      't:quill': 2,
    });
  });

  it('removes a reserved row whose count falls to 0, and leaves a name key that one entry holds without a row', async () => {
    const one = await insertTestSync(database.db, LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        scripted({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery', 't:quill'] }] }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);
    expect(await table()).toEqual({ [WATCHLIST_NAME_COUNT_KEY]: 1, [SCRIPT('latin')]: 1 });

    await markEntriesRemoved(database.db, { sourceId: LIST, entryIds: ['SYN-1'], at: NOW });
    await applyWatchlistKeyDfDelta(
      database.db,
      LIST,
      shares({
        't:avery': { reserved: false, count: -1 },
        't:quill': { reserved: false, count: -1 },
        [WATCHLIST_NAME_COUNT_KEY]: { reserved: true, count: -1 },
        [SCRIPT('latin')]: { reserved: true, count: -1 },
      }),
    );

    expect(await table()).toEqual({});
    expect(await rebuilt()).toEqual({});
  });
});

/** A small deterministic generator (mulberry32), so each sequence is one seed's. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A synthetic entry drawn from a small vocabulary, so counts cross 1 and 2 often. */
function drawn(next: () => number, id: string, version: number): WatchlistEntryWrite {
  const word = () => `t:w${String(Math.floor(next() * 12))}`;
  const names = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, index) => ({
    name: `Synthetic ${id} ${String(version)} ${String(index)}`,
    keys: Array.from({ length: Math.floor(next() * 4) }, word),
    quality: next() < 0.2 ? ('weak' as const) : ('strong' as const),
  }));
  const scripts = names.map(() => (next() < 0.25 ? 'cyrillic' : 'latin'));
  return scripted({ id, names, content: String(version % 10) }, scripts);
}

describe('the tracker over a seeded sequence of changes (C270.1)', () => {
  for (const [label, applyAtKeys] of [
    ['applied once, at the end', undefined],
    ['applied after every recorded key', 1],
    ['applied every 7 recorded keys', 7],
  ] as const) {
    it(`equals a full rebuild after every change, ${label}`, async () => {
      const next = random(label.length * 7919);
      const ids = Array.from({ length: 40 }, (_, index) => `SYN-${String(index)}`);
      const live = new Set<string>();
      const removed = new Set<string>();
      let version = 0;
      for (let step = 0; step < 12; step += 1) {
        const syncId = await insertTestSync(database.db, LIST);
        const tracker = trackWatchlistKeyDf(
          database.db,
          LIST,
          applyAtKeys === undefined ? {} : { applyAtKeys },
        );
        const writes: WatchlistEntryWrite[] = [];
        for (const id of ids) {
          const roll = next();
          version += 1;
          if (!live.has(id) && roll < 0.3) {
            // An add, or a re-listing of a removed entry.
            writes.push(drawn(next, id, version));
          } else if (live.has(id) && roll < 0.15) {
            // A rename: new names, so new keys and scripts.
            writes.push({ ...drawn(next, id, version), change: 'changed', contentChanged: true });
          } else if (live.has(id) && roll < 0.25) {
            // A risk-only change: the names are not rewritten.
            writes.push({
              ...drawn(next, id, version),
              change: 'changed',
              contentChanged: false,
              names: [],
            });
          }
        }
        for (const batch of [writes.slice(0, 5), writes.slice(5)]) {
          const replaced = batch
            .filter((write) => write.change === 'added' || write.contentChanged)
            .map((write) => write.entryId);
          await tracker.track(replaced, () =>
            writeWatchlistEntries(database.db, { sourceId: LIST, syncId, entries: batch }),
          );
        }
        for (const write of writes) {
          live.add(write.entryId);
          removed.delete(write.entryId);
        }
        const leaving = [...live].filter(
          (id) => !writes.some((write) => write.entryId === id) && next() < 0.15,
        );
        await tracker.track(leaving, () =>
          markEntriesRemoved(database.db, { sourceId: LIST, entryIds: leaving, at: NOW }),
        );
        for (const id of leaving) {
          live.delete(id);
          removed.add(id);
        }
        await tracker.finish();

        expect(await table(), `after change ${String(step)}`).toEqual(await rebuilt());
      }
      expect(removed.size + live.size).toBeGreaterThan(0);
      expect(Object.keys(await table()).length).toBeGreaterThan(2);
    });
  }

  it('applies once the recorded keys reach its bound, before it is finished', async () => {
    const syncId = await insertTestSync(database.db, LIST);
    const entries = [
      scripted({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery'] }] }),
      scripted({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery'] }] }),
    ];
    const bounded = trackWatchlistKeyDf(database.db, LIST, { applyAtKeys: 1 });
    await bounded.track(['SYN-1', 'SYN-2'], () =>
      writeWatchlistEntries(database.db, { sourceId: LIST, syncId, entries }),
    );
    expect(await table()).toMatchObject({ 't:avery': 2 });

    await resetWatchlists(database.db);
    const later = await insertTestSync(database.db, LIST);
    const unbounded = trackWatchlistKeyDf(database.db, LIST);
    await unbounded.track(['SYN-1', 'SYN-2'], () =>
      writeWatchlistEntries(database.db, { sourceId: LIST, syncId: later, entries }),
    );
    expect(await table()).toEqual({});
    await unbounded.finish();
    expect(await table()).toEqual(await rebuilt());
  });

  it('leaves no written name waiting in the pending lists once finished, as the rebuild does (owner decision 1 after 6B)', async () => {
    const syncId = await insertTestSync(database.db, LIST);
    const tracker = trackWatchlistKeyDf(database.db, LIST);
    await tracker.track(['SYN-1', 'SYN-2'], () =>
      writeWatchlistEntries(database.db, {
        sourceId: LIST,
        syncId,
        entries: [
          scripted({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery'] }] }),
          scripted({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery'] }] }),
        ],
      }),
    );
    await tracker.finish();

    const [pending] = (
      await database.db.execute(
        sql`select gin_clean_pending_list('watchlist_names_keys_idx'::regclass)::int as keys,
                   gin_clean_pending_list('watchlist_names_normalised_trgm_idx'::regclass)::int
                     as trigrams`,
      )
    ).rows;
    expect(pending).toEqual({ keys: 0, trigrams: 0 });
  });

  it('binds entry ids and keys as one text[] parameter per statement, whatever their number (owner decision 4 after 6C)', async () => {
    const syncId = await insertTestSync(database.db, LIST);
    const held = ['t:avery', "t:o'hare", "p:t:avery+t:o'hare", 'j:a,b', 't:{x}', 't:"q"', 't:\\n'];
    const many = Array.from({ length: 1_200 }, (_, index) =>
      scripted({ id: `SYN-${String(index)}`, names: [{ name: 'Avery Ohare', keys: held }] }),
    );
    const query = vi.spyOn(database.client, 'query');
    try {
      const tracker = trackWatchlistKeyDf(database.db, LIST);
      await tracker.track(
        many.map((write) => write.entryId),
        () => writeWatchlistEntries(database.db, { sourceId: LIST, syncId, entries: many }),
      );
      await tracker.finish();

      const reads = query.mock.calls.filter(
        ([text]) => text.includes('watchlist_key_df') || text.includes('unnest(n.keys)'),
      );
      expect(reads.length).toBeGreaterThan(0);
      expect(Math.max(...reads.map(([, params]) => params?.length ?? 0))).toBeLessThanOrEqual(4);
    } finally {
      query.mockRestore();
    }
    expect(await table()).toEqual(await rebuilt());
    expect(await table()).toMatchObject(Object.fromEntries(held.map((key) => [key, 1_200])));
  });
});

describe('the GIN options a sync may take (C270.3)', () => {
  const setting = async (db: Pick<TestDatabase['db'], 'execute'>) =>
    String(
      (await db.execute(sql`select current_setting('gin_pending_list_limit') as limit`)).rows[0]
        ?.limit,
    );

  it('sets the pending-list limit for the rest of the transaction only', async () => {
    const before = await setting(database.db);
    let inside = '';
    await database.db.transaction(async (tx) => {
      await setWatchlistGinPendingListLimit(tx, 256);
      inside = await setting(tx);
    });

    expect(inside).toBe('256kB');
    expect(await setting(database.db)).toBe(before);
  });

  it('moves what the names’ indexes hold pending into them', async () => {
    const syncId = await insertTestSync(database.db, LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId,
      entries: [
        scripted({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery'] }] }),
        scripted({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery'] }] }),
      ],
    });

    await cleanWatchlistGinPendingLists(database.db, LIST);

    const [pending] = (
      await database.db.execute(
        sql`select gin_clean_pending_list('watchlist_names_keys_idx'::regclass)::int as keys,
                   gin_clean_pending_list('watchlist_names_normalised_trgm_idx'::regclass)::int
                     as trigrams`,
      )
    ).rows;
    expect(pending).toEqual({ keys: 0, trigrams: 0 });
  });
});
