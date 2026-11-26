/**
 * C78.3: the key frequencies over the live strong names, with the name count under its reserved
 * key, over PGlite. Every list value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing.js';
import {
  rebuildWatchlistKeyDf,
  watchlistKeyFrequencies,
  watchlistKeyFrequencyTable,
  WATCHLIST_NAME_COUNT_KEY,
  WATCHLIST_SCRIPT_KEY_PREFIX,
} from './watchlist-key-df.js';
import { markEntriesRemoved, writeWatchlistEntries } from './watchlists.js';
import { LIST, NOW, entry, insertTestSync, resetWatchlists } from './watchlists.test-support.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const reset = () => resetWatchlists(database.db);
const sync = (sourceId: string) => insertTestSync(database.db, sourceId);

const counts = async () =>
  Object.fromEntries(
    (
      await database.db.execute(
        sql`select key, count from watchlist_key_df where source_id = ${LIST} order by key`,
      )
    ).rows.map((row) => [String(row.key), Number(row.count)]),
  );

describe('the key frequencies (C78.3)', () => {
  beforeEach(reset);

  it('counts each key over the live entries that hold it, as the candidate cap counts, not over names (owner decision 1 after 6B)', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        entry({
          id: 'SYN-1',
          names: [
            { name: 'Avery Quill', keys: ['t:avery', 't:quill'] },
            { name: 'Quill Avery', keys: ['t:avery', 't:quill'] },
          ],
        }),
        entry({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery', 't:dale'] }] }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);

    expect(await counts()).toMatchObject({
      [WATCHLIST_NAME_COUNT_KEY]: 3,
      't:avery': 2,
    });
    // A key one entry holds is left out: within every bound, it needs no row (owner decision 1
    // after 6B; most pair keys are held by one entry).
    expect(await counts()).not.toHaveProperty('t:dale');
    expect(await counts()).not.toHaveProperty('t:quill');
  });

  it('counts the live names of each script under its reserved key, weak aliases included (owner decision 13 after 6B)', async () => {
    const one = await sync(LIST);
    const written = entry({
      id: 'SYN-1',
      names: [
        { name: 'Avery Quill', keys: ['t:avery', 't:quill'] },
        { name: 'Эйвери Квилл', keys: ['t:eiveri'] },
        { name: 'Avy', keys: [], quality: 'weak' },
      ],
    });
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        {
          ...written,
          names: written.names.map((name) =>
            name.ordinal === 1 ? { ...name, script: 'cyrillic' } : name,
          ),
        },
        entry({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery', 't:dale'] }] }),
      ],
    });
    await markEntriesRemoved(database.db, { sourceId: LIST, entryIds: ['SYN-2'], at: NOW });
    await rebuildWatchlistKeyDf(database.db, LIST);

    const all = await counts();
    expect(
      Object.fromEntries(
        Object.entries(all).filter(([key]) => key.startsWith(WATCHLIST_SCRIPT_KEY_PREFIX)),
      ),
    ).toEqual({
      [`${WATCHLIST_SCRIPT_KEY_PREFIX}cyrillic`]: 1,
      [`${WATCHLIST_SCRIPT_KEY_PREFIX}latin`]: 2,
    });
  });

  it('counts each key over the live strong names, with the name count under its reserved key', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        entry({
          id: 'SYN-1',
          names: [
            { name: 'Avery Quill', keys: ['t:avery', 't:quill'] },
            { name: 'Avy', keys: [], quality: 'weak' },
          ],
        }),
        entry({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery', 't:dale'] }] }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);
    expect(await counts()).toMatchObject({
      [WATCHLIST_NAME_COUNT_KEY]: 2,
      't:avery': 2,
    });

    const two = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      entries: [entry({ id: 'SYN-1', change: 'unchanged', names: [] })],
    });
    await markEntriesRemoved(database.db, { sourceId: LIST, entryIds: ['SYN-2'], at: NOW });
    await rebuildWatchlistKeyDf(database.db, LIST);
    expect(await counts()).toEqual({
      [WATCHLIST_NAME_COUNT_KEY]: 1,
      [`${WATCHLIST_SCRIPT_KEY_PREFIX}latin`]: 2,
    });
  });

  it('leaves no written name waiting in the pending lists of the key and trigram indexes, which every probe would also read (owner decision 1 after 6B)', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        entry({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery', 't:quill'] }] }),
        entry({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery', 't:dale'] }] }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);

    // `gin_clean_pending_list` moves what is still pending into the index and says how many
    // pending pages it emptied: none are left after the rebuild.
    const [pending] = (
      await database.db.execute(
        sql`select gin_clean_pending_list('watchlist_names_keys_idx'::regclass)::int as keys,
                   gin_clean_pending_list('watchlist_names_normalised_trgm_idx'::regclass)::int
                     as trigrams`,
      )
    ).rows;
    expect(pending).toEqual({ keys: 0, trigrams: 0 });
  });

  it('reads the frequencies of the given keys, leaving out the keys no entry holds (owner decision 3 after 6B)', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        entry({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery', 't:quill'] }] }),
        entry({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery', 't:dale'] }] }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);

    expect(
      Object.fromEntries(
        await watchlistKeyFrequencies(database.db, LIST, ['t:avery', 't:dale', 't:nobody']),
      ),
    ).toEqual({ 't:avery': 2 });
    expect(await watchlistKeyFrequencies(database.db, LIST, [])).toEqual(new Map());
  });

  it('reads a source’s whole frequency table in one statement, or nothing when it holds more rows than asked (owner decision 4 after 6C)', async () => {
    const one = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: [
        entry({ id: 'SYN-1', names: [{ name: 'Avery Quill', keys: ['t:avery', 't:quill'] }] }),
        entry({ id: 'SYN-2', names: [{ name: 'Avery Dale', keys: ['t:avery', 't:dale'] }] }),
        entry({ id: 'SYN-3', names: [{ name: 'Rowan Dale', keys: ['t:rowan', 't:dale'] }] }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);
    const stored = await counts();

    const whole = await watchlistKeyFrequencyTable(database.db, LIST, Object.keys(stored).length);

    expect(Object.fromEntries(whole ?? [])).toEqual(stored);
    expect(whole?.get('t:avery')).toBe(2);
    expect(whole?.has('t:quill')).toBe(false);
    expect(
      await watchlistKeyFrequencyTable(database.db, LIST, Object.keys(stored).length - 1),
    ).toBeNull();
    expect(await watchlistKeyFrequencyTable(database.db, 'synthetic-empty-list', 0)).toEqual(
      new Map(),
    );
  });

  it('binds the keys as one text[] parameter per statement, whatever their number (owner decision 4 after 6C)', async () => {
    const one = await sync(LIST);
    // Keys as the matcher writes them, with the characters an array literal must escape.
    const held = ['t:avery', "t:o'hare", "p:t:avery+t:o'hare", 'j:a,b', 't:{x}', 't:"q"', 't:\\n'];
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: one,
      entries: ['SYN-1', 'SYN-2'].map((id) =>
        entry({ id, names: [{ name: 'Avery Ohare', keys: held }] }),
      ),
    });
    await rebuildWatchlistKeyDf(database.db, LIST);
    const absent = Array.from({ length: 12_000 }, (_, index) => `t:absent${String(index)}`);
    const query = vi.spyOn(database.client, 'query');
    try {
      const found = await watchlistKeyFrequencies(database.db, LIST, [...absent, ...held, ...held]);

      expect(Object.fromEntries(found)).toEqual(Object.fromEntries(held.map((key) => [key, 2])));
      const reads = query.mock.calls.filter(([text]) => text.includes('watchlist_key_df'));
      expect(reads.length).toBeGreaterThan(0);
      expect(Math.max(...reads.map(([, params]) => params?.length ?? 0))).toBeLessThanOrEqual(2);
    } finally {
      query.mockRestore();
    }
  });
});
