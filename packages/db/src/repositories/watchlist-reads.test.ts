/**
 * C78.3 (V11), C76.6: candidate retrieval on each of its paths and the entry loader, over PGlite
 * with pg_trgm loaded. Every list value is synthetic: fictional names, `SYN-` ids.
 */
import { keyFrequencyBound } from '@openverify/core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../client.js';
import { createTestDatabase, type TestDatabase } from '../testing.js';
import { rebuildWatchlistKeyDf } from './watchlist-key-df.js';
import {
  getWatchlistSourceStates,
  loadEntries,
  retrieveCandidates,
  useWatchlistReadShortcuts,
} from './watchlist-reads.js';
import { useWatchlistSwitches, watchlistSwitchEnabled } from './watchlist-switches.js';
import { markEntriesRemoved, writeWatchlistEntries } from './watchlists.js';
import {
  HASH,
  LIST,
  NOW,
  SANDBOX,
  candidateQuery,
  entry,
  insertTestSync,
  resetWatchlists,
  writeFillers,
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
const fillers = (sourceId: string, syncId: number, count: number) =>
  writeFillers(database.db, sourceId, syncId, count);

describe('candidate retrieval and the loaders (C78.3, C76.6)', () => {
  beforeEach(async () => {
    await reset();
    const syncId = await sync(LIST);
    await fillers(LIST, syncId, 100);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId,
      entries: [
        entry({
          id: 'SYN-1',
          names: [
            { name: 'Avery Quillfeather', keys: ['t:avery', 't:quillfeather', 't:person'] },
            { name: 'Avy Quill', keys: [], quality: 'weak', normalised: 'avy quill' },
          ],
          identifiers: [{ kind: 'passport', value: 'SP1234567', country: 'GB' }],
        }),
        entry({
          id: 'SYN-2',
          names: [{ name: 'Avery Dalewood', keys: ['t:avery', 't:dalewood'] }],
          crypto: ['0xsyntheticaddress'],
        }),
        entry({
          id: 'SYN-3',
          kind: 'entity',
          names: [{ name: 'Quillfeather Holdings', keys: ['t:quillfeather', 't:holdings'] }],
          identifiers: [{ kind: 'lei', value: 'SYNT00000000000000X1' }],
        }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);
    const sandboxSync = await sync(SANDBOX);
    await writeWatchlistEntries(database.db, {
      sourceId: SANDBOX,
      syncId: sandboxSync,
      entries: [
        entry({ id: 'SBX-1', names: [{ name: 'Avery Sandbox', keys: ['t:avery', 't:sandbox'] }] }),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, SANDBOX);
  });

  const found = (result: { candidates: { sourceId: string; entryId: string }[] }) =>
    result.candidates.map(({ sourceId, entryId }) => `${sourceId}/${entryId}`);

  it('ranks the entries by the rare keys they share, ignoring keys held by more entries than their bound', async () => {
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({ keys: ['t:avery', 't:quillfeather', 't:person'], cap: 40 }),
    );

    expect(result.truncated).toBe(false);
    expect(result.candidates.slice(0, 3)).toEqual([
      { sourceId: LIST, entryId: 'SYN-1', sharedKeys: 2, via: ['keys'] },
      { sourceId: LIST, entryId: 'SYN-2', sharedKeys: 1, via: ['keys'] },
      { sourceId: LIST, entryId: 'SYN-3', sharedKeys: 1, via: ['keys'] },
    ]);
    // `t:person` is held by 101 entries, over the bound of a cap of 40 (10): never used, so no
    // filler is a candidate.
    expect(keyFrequencyBound(40)).toBe(10);
    expect(found(result)).not.toContain(`${LIST}/SYN-F0000`);
    expect(found(result)).toContain(`${SANDBOX}/SBX-1`);
  });

  it('leaves sandbox-only sources and removed entries out for production', async () => {
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({ environmentKind: 'production', keys: ['t:avery'] }),
    );

    expect(found(result)).toEqual([`${LIST}/SYN-1`, `${LIST}/SYN-2`]);
    expect(
      await loadEntries(database.db, {
        environmentKind: 'production',
        entries: [
          { sourceId: SANDBOX, entryId: 'SBX-1' },
          { sourceId: LIST, entryId: 'SYN-1' },
        ],
      }),
    ).toMatchObject([{ sourceId: LIST, entryId: 'SYN-1' }]);
  });

  it('searches only the given kinds by name, and every kind by identifier', async () => {
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        keys: ['t:quillfeather'],
        entryKinds: ['entity'],
        identifiers: [{ kind: 'passport', value: 'SP1234567' }],
      }),
    );

    expect(result.candidates).toEqual([
      { sourceId: LIST, entryId: 'SYN-1', sharedKeys: 0, via: ['identifier'] },
      { sourceId: LIST, entryId: 'SYN-3', sharedKeys: 1, via: ['keys'] },
    ]);
  });

  it('finds an entry by identifier or crypto address whatever its names say (H06)', async () => {
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        identifiers: [{ kind: 'lei', value: 'SYNT00000000000000X1', country: 'FR' }],
        cryptoAddresses: ['0xsyntheticaddress'],
      }),
    );

    expect(result.candidates).toEqual([
      { sourceId: LIST, entryId: 'SYN-2', sharedKeys: 0, via: ['crypto'] },
      { sourceId: LIST, entryId: 'SYN-3', sharedKeys: 0, via: ['identifier'] },
    ]);
  });

  it('uses the trigram path when no rare key is left, and for a single token', async () => {
    const common = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        keys: ['t:person'],
        normalisedName: 'avery quilfeather',
        cap: 40,
      }),
    );
    expect(found(common)[0]).toBe(`${LIST}/SYN-1`);
    expect(common.candidates[0]?.via).toEqual(['trigram']);

    const single = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], keys: ['t:dalewood'], normalisedName: 'dalewood' }),
    );
    expect(found(single)).toEqual([`${LIST}/SYN-2`]);
    expect(single.candidates[0]?.via).toEqual(['keys', 'trigram']);
  });

  it('looks weak aliases up by exact normalised equality, only when asked (H10)', async () => {
    const without = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        normalisedName: 'avy quill',
        keys: ['t:avy', 't:quill'],
      }),
    );
    const withAliases = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        normalisedName: 'avy quill',
        keys: ['t:avy', 't:quill'],
        weakAliases: true,
      }),
    );

    expect(without.candidates.find(({ entryId }) => entryId === 'SYN-1')?.via ?? []).not.toContain(
      'weak_alias',
    );
    expect(withAliases.candidates.find(({ entryId }) => entryId === 'SYN-1')?.via).toContain(
      'weak_alias',
    );
  });

  it('stops at the cap and says the search was cut short (H12)', async () => {
    const result = await retrieveCandidates(
      database.db,
      // A cap of 2 bounds each key at one entry (keyFrequencyBound): three keys of one entry each.
      candidateQuery({
        sourceIds: [LIST, SANDBOX],
        keys: ['t:dalewood', 't:holdings', 't:sandbox'],
        cap: 2,
      }),
    );

    expect(result.truncated).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });

  it('states the scripts each source’s live names are written in (owner decision 13 after 6B)', async () => {
    const states = await getWatchlistSourceStates(database.db, [LIST, SANDBOX, 'synthetic-other']);
    expect(Object.fromEntries(states.map((state) => [state.id, state.scripts]))).toEqual({
      [LIST]: ['latin'],
      [SANDBOX]: ['latin'],
      'synthetic-other': [],
    });
  });

  it('loads a page of the live entries a sync added or changed beside the candidates (owner decision 3 after 6B)', async () => {
    const two = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      entries: [
        entry({ id: 'SYN-7', names: [{ name: 'Orlan Vexby', keys: ['t:orlan', 't:vexby'] }] }),
        entry({ id: 'SYN-8', names: [{ name: 'Talia Quist', keys: ['t:talia', 't:quist'] }] }),
        entry({ id: 'SYN-9', names: [{ name: 'Ansel Moor', keys: ['t:ansel', 't:moor'] }] }),
      ],
    });
    await markEntriesRemoved(database.db, { sourceId: LIST, entryIds: ['SYN-9'], at: NOW });
    const load = (afterEntryId?: string) =>
      loadEntries(database.db, {
        environmentKind: 'sandbox',
        entries: [{ sourceId: LIST, entryId: 'SYN-1' }],
        changedInSync: { syncId: two, afterEntryId, limit: 1 },
      });

    expect((await load()).map((record) => record.entryId)).toEqual(['SYN-1', 'SYN-7']);
    expect((await load('SYN-7')).map((record) => record.entryId)).toEqual(['SYN-1', 'SYN-8']);
    expect((await load('SYN-8')).map((record) => record.entryId)).toEqual(['SYN-1']);
  });

  it('loads the candidates’ records, removed ones included', async () => {
    const two = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId: two,
      entries: [entry({ id: 'SYN-1', change: 'unchanged', names: [] })],
    });
    await markEntriesRemoved(database.db, { sourceId: LIST, entryIds: ['SYN-2'], at: NOW });

    const records = await loadEntries(database.db, {
      environmentKind: 'sandbox',
      entries: [
        { sourceId: LIST, entryId: 'SYN-2' },
        { sourceId: SANDBOX, entryId: 'SBX-1' },
        { sourceId: LIST, entryId: 'SYN-404' },
      ],
    });

    expect(records).toEqual([
      {
        sourceId: LIST,
        entryId: 'SYN-2',
        kind: 'individual',
        contentHash: HASH('a'),
        riskDataHash: HASH('b'),
        data: { entry_id: 'SYN-2', synthetic: true },
        removedAt: NOW,
      },
      {
        sourceId: SANDBOX,
        entryId: 'SBX-1',
        kind: 'individual',
        contentHash: HASH('a'),
        riskDataHash: HASH('b'),
        data: { entry_id: 'SBX-1', synthetic: true },
        removedAt: null,
      },
    ]);
    expect(await loadEntries(database.db, { environmentKind: 'sandbox', entries: [] })).toEqual([]);
  });

  it('binds the candidates as two text[] parameters, one statement for 1,200 of them, with the same records (owner decision 3 after 6C)', async () => {
    const wanted = [
      { sourceId: SANDBOX, entryId: 'SBX-1' },
      ...Array.from({ length: 1_198 }, (_, index) => ({
        sourceId: LIST,
        entryId: `SYN-${String(index)}`,
      })),
      { sourceId: LIST, entryId: 'SYN-404' },
    ];
    const load = async (on: boolean) => {
      const restore = useWatchlistReadShortcuts({ 'array-parameters': on });
      const statements: { sql: string; params: number }[] = [];
      try {
        const records = await loadEntries(recordingParameters(database.db, statements), {
          environmentKind: 'sandbox',
          entries: wanted,
        });
        return { records, statements };
      } finally {
        restore();
      }
    };
    const off = await load(false);
    const on = await load(true);

    expect(on.records.length).toBeGreaterThan(2);
    expect(on.records).toEqual(off.records);
    expect(off.statements.map(({ params }) => params)).toEqual([1_000, 1_000, 400]);
    expect(on.statements.map(({ params }) => params)).toEqual([2]);
  });
});

describe('the key bound, the pair keys and the reach of a search (owner decision 1 after 6B)', () => {
  const found = (result: { candidates: { sourceId: string; entryId: string }[] }) =>
    result.candidates.map(({ sourceId, entryId }) => `${sourceId}/${entryId}`);
  /** Entries named `<first> <second>`, each keyed as `listNameKeys` keys them (forms only). */
  const named = (id: string, first: string, second: string) =>
    entry({
      id,
      names: [
        {
          name: `${first} ${second}`,
          keys: [`t:${first}`, `t:${second}`, `p:t:${[first, second].sort().join('+t:')}`],
        },
      ],
    });
  const MARIA_ELENA_GARCIA = {
    keys: [
      'p:t:elena+t:garcia',
      'p:t:elena+t:maria',
      'p:t:garcia+t:maria',
      't:elena',
      't:garcia',
      't:maria',
    ],
    reach: [
      ['p:t:elena+t:maria', 't:elena', 't:maria'],
      ['p:t:garcia+t:maria', 't:garcia', 't:maria'],
      ['p:t:elena+t:garcia', 't:elena', 't:garcia'],
    ],
  };
  const MARIA_GARCIA = {
    keys: ['p:t:garcia+t:maria', 't:garcia', 't:maria'],
    reach: [['p:t:garcia+t:maria', 't:garcia', 't:maria']],
  };

  /** 11 `Maria …` and 11 `… Garcia` entries: over the bound of a cap of 40 (10 entries). */
  async function commonNames(mariaGarcias: number) {
    await reset();
    const syncId = await sync(LIST);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId,
      entries: [
        ...Array.from({ length: 11 }, (_, index) =>
          named(`SYN-M${String(index)}`, 'maria', `quillon${String(index)}`),
        ),
        ...Array.from({ length: 11 }, (_, index) =>
          named(`SYN-G${String(index)}`, `vexby${String(index)}`, 'garcia'),
        ),
        ...Array.from({ length: mariaGarcias }, (_, index) =>
          named(`SYN-MG${String(index)}`, 'maria', 'garcia'),
        ),
        named('SYN-E1', 'elena', 'westbrook'),
      ],
    });
    await rebuildWatchlistKeyDf(database.db, LIST);
  }

  it('bounds a key by the entries holding it, a share of the cap, whatever share of the names that is', async () => {
    await reset();
    const syncId = await sync(LIST);
    await fillers(LIST, syncId, 600);
    await writeWatchlistEntries(database.db, {
      sourceId: LIST,
      syncId,
      entries: Array.from({ length: 11 }, (_, index) =>
        named(`SYN-Q${String(index)}`, 'quillfeather', `avery${String(index)}`),
      ),
    });
    await rebuildWatchlistKeyDf(database.db, LIST);

    // 11 entries is under 2% of the 611 names, but over the bound of a cap of 40 (10).
    const over = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], keys: ['t:quillfeather'], cap: 40 }),
    );
    expect(over.candidates).toEqual([]);
    const under = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], keys: ['t:quillfeather'], cap: 44 }),
    );
    expect(under.candidates).toHaveLength(11);
  });

  it('retrieves the listed Maria Garcia for Maria Elena Garcia through the pair key, maria and garcia over the bound and elena rare', async () => {
    await commonNames(1);
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], cap: 40, ...MARIA_ELENA_GARCIA }),
    );

    expect(found(result)).toEqual([`${LIST}/SYN-E1`, `${LIST}/SYN-MG0`]);
    expect(result.candidates.find(({ entryId }) => entryId === 'SYN-MG0')).toMatchObject({
      sharedKeys: 1,
      via: ['keys'],
    });
    expect(result.truncated).toBe(false);
  });

  it('says the search was cut short when two subject tokens are reached only through keys over the bound, and still screens the names holding both, up to the cap', async () => {
    await commonNames(11);
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        cap: 40,
        ...MARIA_GARCIA,
        normalisedName: 'maria garcia',
      }),
    );

    expect(result.truncated).toBe(true);
    // The pair key out of reach is looked up itself, up to the cap (all 11 namesakes at a cap of
    // 40, over its bound of 10), so a listed namesake among more holders than the bound is still
    // screened: no trigram scan of the names, which costs seconds on a PEP-scale list (owner
    // decision 1 after 6B).
    expect(found(result)).toHaveLength(11);
    expect(found(result).every((key) => key.startsWith(`${LIST}/SYN-MG`))).toBe(true);
    expect(result.candidates.some(({ via }) => via.includes('trigram'))).toBe(false);
    const capped = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], cap: 5, ...MARIA_GARCIA, normalisedName: null }),
    );
    expect(capped.candidates).toHaveLength(5);
    expect(capped.truncated).toBe(true);
    // A third token does not help: the names holding maria and garcia are still out of reach.
    const third = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], cap: 40, ...MARIA_ELENA_GARCIA }),
    );
    expect(third.truncated).toBe(true);
    // With a bound over the pair's 11 entries, every name holding both is reached.
    const wider = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], cap: 48, ...MARIA_GARCIA }),
    );
    expect(wider.truncated).toBe(false);
    expect(found(wider)).toHaveLength(11);
  });

  it('says the search was cut short only when the cap actually cuts it', async () => {
    await commonNames(1);
    const exactly = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], cap: 2, ...MARIA_ELENA_GARCIA }),
    );
    expect(exactly.candidates).toHaveLength(2);
    expect(exactly.truncated).toBe(false);
    const cut = await retrieveCandidates(
      database.db,
      candidateQuery({ sourceIds: [LIST], cap: 1, ...MARIA_ELENA_GARCIA }),
    );
    expect(cut.candidates).toHaveLength(1);
    expect(cut.truncated).toBe(true);
  });

  it('still searches the trigrams of a name whose keys reach no entry at all', async () => {
    await commonNames(1);
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        cap: 40,
        keys: ['p:t:elina+t:westbrok', 't:elina', 't:westbrok'],
        reach: [['p:t:elina+t:westbrok', 't:elina', 't:westbrok']],
        normalisedName: 'elina westbrok',
      }),
    );
    expect(result.truncated).toBe(false);
    expect(result.candidates.map(({ entryId, via }) => [entryId, via])).toContainEqual([
      'SYN-E1',
      ['trigram'],
    ]);
  });

  it('searches the trigrams of a name whose one keyed token is out of reach, which has no pair to look up', async () => {
    await commonNames(1);
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        cap: 40,
        // "M. Garcia": the initial gives no key, garcia is over the bound, a crossing key is rare.
        keys: ['j:garcia', 't:garcia', 'j:mgarcia', 't:mgarcia', 't:quillon0'],
        reach: [['t:garcia']],
        normalisedName: 'garcia m',
      }),
    );
    expect(result.truncated).toBe(true);
    expect(result.candidates.some(({ via }) => via.includes('trigram'))).toBe(true);
  });

  it('does not search the trigrams of a name a key held by one entry reaches', async () => {
    await commonNames(1);
    const result = await retrieveCandidates(
      database.db,
      candidateQuery({
        sourceIds: [LIST],
        cap: 40,
        keys: ['p:t:elena+t:westbrook', 't:elena', 't:westbrook'],
        reach: [['p:t:elena+t:westbrook', 't:elena', 't:westbrook']],
        normalisedName: 'elena westbrook',
      }),
    );
    expect(result.candidates.map(({ entryId, via }) => [entryId, via])).toEqual([
      ['SYN-E1', ['keys']],
    ]);
  });

  it('folds the rare-key lookup into the candidate query: one statement for a search by keys', async () => {
    await commonNames(1);
    const statements: string[] = [];

    const result = await retrieveCandidates(
      recording(database.db, statements),
      candidateQuery({ sourceIds: [LIST], cap: 40, ...MARIA_ELENA_GARCIA }),
    );

    expect(found(result)).toContain(`${LIST}/SYN-MG0`);
    expect(statements.filter((statement) => !statement.startsWith('set local'))).toHaveLength(1);
  });

  it('runs its statements with JIT compilation off, which costs more than these look-ups take', async () => {
    await commonNames(1);
    const statements: string[] = [];

    await retrieveCandidates(
      recording(database.db, statements),
      candidateQuery({
        sourceIds: [LIST],
        cap: 40,
        ...MARIA_ELENA_GARCIA,
        normalisedName: 'garcia',
      }),
    );

    // One transaction: its first statement turns JIT off for itself, and every look-up follows.
    expect(statements[0]).toBe('set local jit = off');
    expect(statements.length).toBeGreaterThan(1);
  });
});

/** `db`, recording each statement it executes with the number of parameters it binds. */
function recordingParameters(db: Db, statements: { sql: string; params: number }[]): Db {
  return new Proxy(db, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property === 'execute' && typeof value === 'function') {
        return (query: SQL) => {
          const { sql, params } = new PgDialect().sqlToQuery(query);
          statements.push({ sql: sql.trim(), params: params.length });
          return (value as (query: unknown) => unknown).call(target, query);
        };
      }
      return value;
    },
  });
}

/**
 * `db`, recording the text of every statement it executes, also inside the transactions it opens.
 */
function recording(db: Db, statements: string[]): Db {
  return new Proxy(db, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property === 'execute' && typeof value === 'function') {
        return (query: SQL) => {
          statements.push(new PgDialect().sqlToQuery(query).sql.trim());
          return (value as (query: unknown) => unknown).call(target, query);
        };
      }
      if (property === 'transaction' && typeof value === 'function') {
        return (run: (tx: Db) => Promise<unknown>) =>
          (value as (run: (tx: Db) => Promise<unknown>) => Promise<unknown>).call(
            target,
            (tx: Db) => run(recording(tx, statements)),
          );
      }
      return value;
    },
  });
}

/**
 * C271.2 (Workflow 11D, `matcher-c787-11d`; Stage 1a amendment 4, the lever `retrieval-reach`): the
 * candidate statement's ranking makes each key's holders distinct inside that key's own lookup, so
 * the ranking groups each (source, entry) once per key without first sorting every (source, entry,
 * key) row of every name (development tables, 2,000,000 names: a search with 90 rare keys spilled
 * that sort of 94,734 rows to disk, 432 ms of the 480 ms statement; 109 ms with the lever). Off by
 * default; every retrieval answers exactly as with it off.
 */
describe('the retrieval-reach lever (C271.2)', () => {
  const answer = (result: Awaited<ReturnType<typeof retrieveCandidates>>) => ({
    candidates: result.candidates,
    truncated: result.truncated,
    capReached: result.capReached,
    unreachable: result.unreachable,
  });

  /** A seeded generator of fractions in [0, 1) (a linear congruential sequence). */
  function fractions(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
  }

  /** Tokens of uneven frequencies; names of an entry share them, so a key repeats within an entry. */
  const TOKENS = Array.from({ length: 24 }, (_, index) => `tok${String(index)}`);
  const keysOf = (tokens: readonly string[]) => {
    const sorted = [...new Set(tokens)].sort();
    const pairs = sorted.flatMap((left, index) =>
      sorted.slice(index + 1).map((right) => `p:t:${left}+t:${right}`),
    );
    return [...sorted.map((token) => `t:${token}`), ...pairs];
  };

  async function seededTable(seed: number) {
    await reset();
    const next = fractions(seed);
    // Low indexes are drawn far more often (a heavy head), so some keys pass any bound.
    const token = () => TOKENS[Math.floor(TOKENS.length * next() ** 2.5)] ?? 'tok0';
    const write = async (sourceId: string, prefix: string, count: number) => {
      const syncId = await sync(sourceId);
      await writeWatchlistEntries(database.db, {
        sourceId,
        syncId,
        entries: Array.from({ length: count }, (_, index) => {
          const names = Array.from({ length: 1 + Math.floor(next() * 3) }, () => {
            const tokens = [token(), token(), ...(next() < 0.3 ? [token()] : [])];
            return {
              name: tokens.join(' '),
              keys: keysOf(tokens),
              ...(next() < 0.1 ? { quality: 'weak' as const } : {}),
            };
          });
          return entry({
            id: `${prefix}${String(index).padStart(3, '0')}`,
            kind: next() < 0.15 ? 'entity' : 'individual',
            names,
          });
        }),
      });
      await rebuildWatchlistKeyDf(database.db, sourceId);
    };
    await write(LIST, 'SYN-R', 120);
    await write(SANDBOX, 'SBX-R', 30);
    await markEntriesRemoved(database.db, {
      sourceId: LIST,
      entryIds: ['SYN-R003', 'SYN-R017', 'SYN-R040'],
      at: NOW,
    });
    return next;
  }

  it('is on by default, ranking with each key made distinct inside its own lookup, and off keeps the old statement', async () => {
    await seededTable(7);
    const query = candidateQuery({ keys: keysOf(['tok1', 'tok5', 'tok9']), cap: 40 });
    const off: string[] = [];
    const turnedOff = useWatchlistSwitches({ 'retrieval-reach': false });
    try {
      await retrieveCandidates(recording(database.db, off), query);
    } finally {
      turnedOff();
    }
    expect(off.join('\n')).toContain('select distinct r.source_id, n.entry_id, r.key');

    // Workflow 11D review (fix-11d): the calibration kept the lever, so it ships on.
    expect(watchlistSwitchEnabled('retrieval-reach')).toBe(true);
    const restore = useWatchlistSwitches({ 'retrieval-reach': true });
    try {
      const on: string[] = [];
      await retrieveCandidates(recording(database.db, on), query);
      const ranking = on.find((statement) => statement.includes('ranked as'));
      expect(ranking).toBeDefined();
      expect(ranking).toContain('select distinct w.entry_id from watchlist_names w');
      expect(ranking).not.toContain('select distinct r.source_id, n.entry_id, r.key');
    } finally {
      restore();
    }
    expect(watchlistSwitchEnabled('retrieval-reach')).toBe(true);
  });

  it.each([11, 29, 53])(
    'answers every seeded search exactly as with the lever off, candidates, ranks and flags (seed %i)',
    async (seed) => {
      const next = await seededTable(seed);
      const queries = Array.from({ length: 24 }, (_, index) => {
        const tokens = Array.from(
          { length: 2 + Math.floor(next() * 3) },
          () => TOKENS[Math.floor(TOKENS.length * next())] ?? 'tok0',
        );
        const keys = keysOf(tokens);
        const unique = [...new Set(tokens)].sort();
        const reach = unique.flatMap((left, at) =>
          unique
            .slice(at + 1)
            .map((right) => [`p:t:${left}+t:${right}`, `t:${left}`, `t:${right}`]),
        );
        return candidateQuery({
          keys,
          reach,
          cap: [3, 8, 20, 60][index % 4] ?? 20,
          environmentKind: index % 5 === 0 ? 'production' : 'sandbox',
          ...(index % 3 === 0 ? { entryKinds: ['individual' as const] } : {}),
          normalisedName: index % 2 === 0 ? tokens.join(' ') : null,
        });
      });
      const off = [];
      const turnedOff = useWatchlistSwitches({ 'retrieval-reach': false });
      try {
        for (const query of queries) {
          off.push(answer(await retrieveCandidates(database.db, query)));
        }
      } finally {
        turnedOff();
      }
      const restore = useWatchlistSwitches({ 'retrieval-reach': true });
      try {
        const on = [];
        for (const query of queries) {
          on.push(answer(await retrieveCandidates(database.db, query)));
        }
        expect(on).toEqual(off);
      } finally {
        restore();
      }
      // The searches reach candidates, cut some at the cap and leave pairs out of reach.
      expect(off.some((result) => result.candidates.length > 0)).toBe(true);
      expect(off.some((result) => result.capReached === true)).toBe(true);
    },
  );
});
