/**
 * C76, C78.3 (V11): the frozen watchlist reads that screening uses: candidate retrieval, the
 * entry loader and the source states, with {@link DB_WATCHLIST_READS}. Their signatures were frozen
 * by `foundation-6` (Workflow 6A Stage 1b): the run framework builds on them and on the in-memory
 * fake of `apps/api/src/test-support/fakes.ts` (`createInMemoryWatchlists`). Each takes the
 * environment's kind and leaves out `sandbox_only` sources in SQL for a production environment
 * (C76.6, P13).
 *
 * List data is public but personal (C73.3): every value bound here is a query parameter, and
 * Postgres is started without bind-parameter logging (C73.8), so no screened name or list entry
 * reaches a server log. Nothing here logs.
 */
import { keyFrequencyBound, LIST_NAME_SCRIPTS } from '@openverify/core';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { EnvironmentKind } from '../schema.js';
import { WATCHLIST_SCRIPT_KEY_PREFIX } from './watchlist-key-df.js';
import { watchlistSwitchEnabled } from './watchlist-switches.js';
import {
  chunks,
  ENTRY_COLUMNS,
  entryRecord,
  rowsOf,
  SOURCE_COLUMNS,
  sourceState,
  textArray,
  type Row,
} from './watchlist-rows.js';

/** C78.3: what one screening retrieves candidates for, built by `watchlist-matcher`'s keys. */
export interface RetrieveCandidatesQuery {
  /** Production leaves out every `sandbox_only` source (C76.6). */
  environmentKind: EnvironmentKind;
  /** The report's pinned, screenable sources. */
  sourceIds: readonly string[];
  /**
   * C78.3 query keys (`t:`, `s:`, `g:`, `j:`, `p:`); only keys held by at most
   * `keyFrequencyBound(cap)` live entries of a source are used there (owner decision 1 after 6B).
   */
  keys: readonly string[];
  /** C78.3 (H06): exact identifier lookups, the country when C79.2 says so. */
  identifiers: readonly { kind: string; value: string; country?: string | null }[];
  /** C79.3: canonical crypto addresses. */
  cryptoAddresses: readonly string[];
  /** The trigram path (`pg_trgm`) for single-token queries and empty key sets; `null` for none. */
  normalisedName: string | null;
  /** At most this many candidates, ranked by shared keys (2,000, C78.3). */
  cap: number;
  /** C78.4: the entry kinds searched; an IMO, MMSI or aircraft identifier searches vessels and aircraft whatever. */
  entryKinds?: readonly ('individual' | 'entity' | 'vessel' | 'aircraft')[];
  /** C78.4 (H10): look weak aliases up by exact normalised equality (`screen-weak-aliases`). */
  weakAliases?: boolean;
  /**
   * Owner decision 1 after 6B: groups of `keys`, each reaching the list names that hold one pair of
   * the subject's keyed tokens (or a name's only keyed token), from `queryNameReach`. A group whose
   * every key is over the bound in a source makes the search `truncated`.
   */
  reach?: readonly (readonly string[])[];
}

type CandidateVia = 'keys' | 'trigram' | 'identifier' | 'crypto' | 'weak_alias';

/** One candidate entry, with how it was found. */
export interface WatchlistCandidate {
  sourceId: string;
  entryId: string;
  /** Query keys the entry's names share (the ranking). */
  sharedKeys: number;
  via: readonly CandidateVia[];
}

export interface RetrievedCandidates {
  candidates: WatchlistCandidate[];
  /**
   * C78.5: the search was cut short (H12): the cap cut it, or some reach group of the query was
   * out of reach (owner decision 1 after 6B).
   */
  truncated: boolean;
  /** The cap cut a path's candidates (a diagnostic beside `truncated`). */
  capReached?: boolean;
  /** Some reach group's keys were all over the bound in a source (a diagnostic beside `truncated`). */
  unreachable?: boolean;
}

const VIA_ORDER: readonly CandidateVia[] = [
  'keys',
  'trigram',
  'identifier',
  'crypto',
  'weak_alias',
];
const EXACT_VIA: ReadonlySet<CandidateVia> = new Set(['identifier', 'crypto', 'weak_alias']);

const kindFilter = (kinds: RetrieveCandidatesQuery['entryKinds']): SQL =>
  kinds === undefined ? sql`` : sql`and e.kind = any(${textArray(kinds)})`;

/**
 * Owner decision 1 after 6B: how many ranked candidates a path checks against their entries, by
 * primary key, before the cap: twice the cap and one, so entries removed since the names were
 * written rarely leave the cap unfilled; a ranked set that reaches it is taken as cut short.
 */
const rankedSlack = (cap: number) => 2 * (cap + 1);

/**
 * The live entry of a ranked candidate `alias`, looked up by its primary key (`LIMIT 1` keeps it
 * a lookup per candidate), never a scan of every entry (owner decision 1 after 6B).
 */
function liveEntry(alias: SQL, kinds: RetrieveCandidatesQuery['entryKinds']): SQL {
  return sql`select 1 from watchlist_entries e
              where e.source_id = ${alias}.source_id and e.entry_id = ${alias}.entry_id
                and e.removed_at is null ${kindFilter(kinds)}
              limit 1`;
}

interface Found {
  sourceId: string;
  entryId: string;
  sharedKeys: number;
  similarity: number;
  via: Set<CandidateVia>;
}

/** Whether some reach group has every key over the bound in a screened source. */
function outOfReach(
  sources: readonly string[],
  reach: RetrieveCandidatesQuery['reach'],
  over: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  return sources.some((sourceId) => {
    const held = over.get(sourceId);
    return held !== undefined && (reach ?? []).some((group) => group.every((key) => held.has(key)));
  });
}

/** Whether a reach group out of reach in a screened source has no pair key to look up. */
function loneOutOfReach(
  sources: readonly string[],
  reach: RetrieveCandidatesQuery['reach'],
  over: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  return sources.some((sourceId) => {
    const held = over.get(sourceId);
    return (reach ?? []).some(
      (group) =>
        held !== undefined &&
        group.every((key) => held.has(key)) &&
        !group.some((key) => key.startsWith('p:')),
    );
  });
}

/** The pair keys of the reach groups whose every key is over the bound in a screened source. */
function outOfReachPairs(
  sources: readonly string[],
  reach: RetrieveCandidatesQuery['reach'],
  over: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const pairs = new Set<string>();
  for (const sourceId of sources) {
    const held = over.get(sourceId);
    for (const group of reach ?? []) {
      if (held !== undefined && group.every((key) => held.has(key))) {
        group.filter((key) => key.startsWith('p:')).forEach((key) => pairs.add(key));
      }
    }
  }
  return [...pairs].sort();
}

/**
 * The entries holding the rare keys, ranked by how many of them they share (owner decision 1 after
 * 6B), the first `slack`. Each key is probed by the key index on its own (`offset 0`).
 *
 * C271.2 (`retrieval-reach`, Workflow 11D; on by default since the 11D calibration kept it): each key's holders are made distinct by
 * entry inside the key's own lookup, so the ranking counts each (source, entry) once per key without
 * first sorting every (source, entry, key) row of every name holding a key; the rows counted, and so
 * the ranking, are the same (development tables, 2,000,000 names: a search with 90 rare keys sorted
 * 94,734 such rows on disk, 432 ms of a 480 ms statement; 109 ms this way).
 */
function rankedByKeys(slack: number): SQL {
  if (watchlistSwitchEnabled('retrieval-reach')) {
    return sql`select k.source_id, k.entry_id, count(*)::int as shared
            from (
              select r.source_id, n.entry_id
                from rare r
                cross join lateral (
                  select distinct w.entry_id from watchlist_names w
                   where w.source_id = r.source_id and w.quality = 'strong'
                     and w.keys @> array[r.key]
                  offset 0) n) k
           group by k.source_id, k.entry_id
           order by shared desc, k.source_id, k.entry_id
           limit ${slack}`;
  }
  return sql`select k.source_id, k.entry_id, count(*)::int as shared
            from (
              select distinct r.source_id, n.entry_id, r.key
                from rare r
                cross join lateral (
                  select w.entry_id from watchlist_names w
                   where w.source_id = r.source_id and w.quality = 'strong'
                     and w.keys @> array[r.key]
                  offset 0) n) k
           group by k.source_id, k.entry_id
           order by shared desc, k.source_id, k.entry_id
           limit ${slack}`;
}

/**
 * C78.3 (V11): candidate retrieval. One statement takes the screenable sources (C76.6), the
 * frequencies of the query keys in them and the candidates of the keys within their bound
 * (owner decision 1 after 6B, decision 11 of the 6A decisions); the trigram, identifier, crypto and
 * weak-alias paths follow only when the query asks for them.
 *
 * The statements run in one transaction with JIT compilation off (`set local jit = off`): on a
 * large list the planner's estimates put them over the JIT thresholds, and compiling took up to
 * 680 ms of statements that ran in under 10 ms (development tables, 2,000,000 names).
 */
export async function retrieveCandidates(
  db: Db,
  query: RetrieveCandidatesQuery,
): Promise<RetrievedCandidates> {
  if (query.sourceIds.length === 0 || query.cap < 1) {
    return { candidates: [], truncated: false };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local jit = off`);
    return retrieveWithin(tx, query);
  });
}

async function retrieveWithin(
  db: Db,
  query: RetrieveCandidatesQuery,
): Promise<RetrievedCandidates> {
  const bound = keyFrequencyBound(query.cap);
  const slack = rankedSlack(query.cap);
  const keys = [...new Set([...query.keys, ...(query.reach ?? []).flat()])];
  // Each key is probed by the key index on its own (`offset 0` keeps the planner from folding the
  // probes into one join): while a sync's names wait in the index's pending list, which every probe
  // also reads, the planner would otherwise price a probe per key of a name with many keys above a
  // scan of every name (development tables: 940 ms against 63 ms at 100,000 names).
  const first = await rowsOf(
    db,
    sql`with src as (
          select id from watchlist_sources
           where id = any(${textArray(query.sourceIds)})
             ${query.environmentKind === 'sandbox' ? sql`` : sql`and not sandbox_only`}),
        df as (
          select d.source_id, d.key, d.count from watchlist_key_df d
           where d.source_id in (select id from src) and d.key = any(${textArray(keys)})),
        rare as (
          select s.id as source_id, k.key
            from src s
            cross join unnest(${textArray(keys)}) as k(key)
           where not exists (
             select 1 from df d where d.source_id = s.id and d.key = k.key and d.count > ${bound})),
        ranked as (${rankedByKeys(slack)}),
        hits as (
          select h.source_id, h.entry_id, h.shared
            from ranked h
            cross join lateral (${liveEntry(sql`h`, query.entryKinds)}) live
           order by h.shared desc, h.source_id, h.entry_id
           limit ${query.cap + 1})
        select 's' as row, id as "sourceId", null::text as "entryId", null::text as key, 0 as shared from src
        union all
        select 'r', source_id, null, key, 0 from df where count <= ${bound}
        union all
        select 'o', source_id, null, key, 0 from df where count > ${bound}
        union all
        select 'c', source_id, entry_id, null, shared from hits
        union all
        select 'n', null, null, null, count(*)::int from ranked`,
  );
  const sources = first.filter((row) => row.row === 's').map((row) => String(row.sourceId));
  if (sources.length === 0) {
    return { candidates: [], truncated: false };
  }
  const inSources = textArray(sources);
  const found = new Map<string, Found>();
  const take = (row: Row, via: CandidateVia, shared = 0, similarity = 0) => {
    const sourceId = String(row.sourceId);
    const entryId = String(row.entryId);
    const key = JSON.stringify([sourceId, entryId]);
    const item = found.get(key) ?? {
      sourceId,
      entryId,
      sharedKeys: 0,
      similarity: 0,
      via: new Set(),
    };
    item.sharedKeys = Math.max(item.sharedKeys, shared);
    item.similarity = Math.max(item.similarity, similarity);
    item.via.add(via);
    found.set(key, item);
  };
  const over = new Map<string, Set<string>>();
  for (const row of first.filter((item) => item.row === 'o')) {
    const sourceId = String(row.sourceId);
    over.set(sourceId, (over.get(sourceId) ?? new Set()).add(String(row.key)));
  }
  const unreachable = outOfReach(sources, query.reach, over);
  // The keys within the bound that some two entries hold (a key one entry holds has no row).
  const rare = first.filter((row) => row.row === 'r');
  const hits = first.filter((row) => row.row === 'c');
  // A ranked set at its slack may hold more live entries than were checked: cut short.
  let capReached =
    hits.length > query.cap || first.some((row) => row.row === 'n' && Number(row.shared) >= slack);

  // 1. Keys within their bound (C78.3): ranked by how many the entry's strong names share.
  hits.slice(0, query.cap).forEach((row) => {
    take(row, 'keys', Number(row.shared));
  });

  // 2. Pairs out of reach (owner decision 1 after 6B): the pair keys of a reach group whose every
  // key is over the bound are looked up themselves, up to the cap, so the names holding both tokens
  // (namesakes) are still screened, a listed one among more holders than the bound included; the
  // search is already cut short. (Up to the bound only, three listed namesakes of 544 to 1,115
  // holders were missed at 2,000,000 development names that the base found.)
  const pairKeys = outOfReachPairs(sources, query.reach, over);
  if (pairKeys.length > 0) {
    const rows = await rowsOf(
      db,
      // The holders are found first (`offset 0`): with the limit beside it, the planner would walk
      // the names in key order testing each name's keys (development tables: 208 ms at 100,000).
      sql`with ranked as (
            select distinct m.source_id, m.entry_id
              from (
                select w.source_id, w.entry_id
                  from watchlist_names w
                 where w.source_id = any(${inSources})
                   and w.quality = 'strong'
                   and w.keys && ${textArray(pairKeys)}
                offset 0) m
             order by m.source_id, m.entry_id
             limit ${slack})
          select * from (
            select t.source_id as "sourceId", t.entry_id as "entryId"
              from ranked t
              cross join lateral (${liveEntry(sql`t`, query.entryKinds)}) live
             order by t.source_id, t.entry_id
             limit ${query.cap + 1}) found
          union all
          select null, count(*)::text from ranked`,
    );
    const counted = rows.filter((row) => row.sourceId === null);
    const live = rows.filter((row) => row.sourceId !== null);
    // A ranked set at its slack may hold more live entries than were checked: cut short.
    capReached ||= live.length > query.cap || Number(counted[0]?.entryId ?? 0) >= slack;
    live.slice(0, query.cap).forEach((row) => {
      take(row, 'keys', 1);
    });
  }

  // 3. Trigrams (C78.3): a single token; a name with a reach group out of reach and no pair key in
  // it to look up (a lone keyed token, such as a common family name beside an initial); or a name
  // its keys reach no entry by (none within the bound has two holders, no key gave a candidate, no
  // pair is out of reach): a spelling the keys miss. The reverse index leaves out the condition on
  // candidates, which only finds more.
  const name = query.normalisedName;
  const lone = loneOutOfReach(sources, query.reach, over);
  if (
    name !== null &&
    name !== '' &&
    (!name.includes(' ') ||
      lone ||
      (rare.length === 0 && hits.length === 0 && pairKeys.length === 0))
  ) {
    const rows = await rowsOf(
      db,
      sql`with ranked as (
            select n.source_id, n.entry_id, max(similarity(n.normalised, ${name}))::float8 as similarity
              from watchlist_names n
             where n.source_id = any(${inSources})
               and n.quality = 'strong'
               and n.normalised % ${name}
             group by n.source_id, n.entry_id
             order by similarity desc, n.source_id, n.entry_id
             limit ${slack})
          select * from (
            select t.source_id as "sourceId", t.entry_id as "entryId", t.similarity
              from ranked t
              cross join lateral (${liveEntry(sql`t`, query.entryKinds)}) live
             order by t.similarity desc, t.source_id, t.entry_id
             limit ${query.cap + 1}) found
          union all
          select null, null, count(*)::float8 from ranked`,
    );
    const ranked = rows.filter((row) => row.sourceId === null);
    const live = rows.filter((row) => row.sourceId !== null);
    capReached ||= live.length > query.cap || Number(ranked[0]?.similarity ?? 0) >= slack;
    live.slice(0, query.cap).forEach((row) => {
      take(row, 'trigram', 0, Number(row.similarity));
    });
  }

  // 4. Identifiers (H06): exact `(kind, value)`, whatever the names or the kinds say; the country
  // is the matcher's check.
  if (query.identifiers.length > 0) {
    const rows = await rowsOf(
      db,
      sql`select distinct i.source_id as "sourceId", i.entry_id as "entryId"
            from watchlist_identifiers i
            join watchlist_entries e on e.source_id = i.source_id and e.entry_id = i.entry_id
           where i.source_id = any(${inSources})
             and (i.kind, i.value_normalised) in (
               select * from unnest(${textArray(query.identifiers.map(({ kind }) => kind))},
                                    ${textArray(query.identifiers.map(({ value }) => value))}))
             and e.removed_at is null`,
    );
    rows.forEach((row) => {
      take(row, 'identifier');
    });
  }

  // 5. Crypto addresses (C79.3): the canonical form.
  if (query.cryptoAddresses.length > 0) {
    const rows = await rowsOf(
      db,
      sql`select distinct c.source_id as "sourceId", c.entry_id as "entryId"
            from watchlist_crypto_addresses c
            join watchlist_entries e on e.source_id = c.source_id and e.entry_id = c.entry_id
           where c.source_id = any(${inSources})
             and c.canonical = any(${textArray(query.cryptoAddresses)})
             and e.removed_at is null`,
    );
    rows.forEach((row) => {
      take(row, 'crypto');
    });
  }

  // 6. Weak aliases (H10): exact normalised equality only, and only when asked.
  if (query.weakAliases === true && name !== null && name !== '') {
    const rows = await rowsOf(
      db,
      sql`select distinct n.source_id as "sourceId", n.entry_id as "entryId"
            from watchlist_names n
            join watchlist_entries e on e.source_id = n.source_id and e.entry_id = n.entry_id
           where n.source_id = any(${inSources})
             and n.quality = 'weak'
             and n.normalised = ${name}
             and e.removed_at is null
             ${kindFilter(query.entryKinds)}`,
    );
    rows.forEach((row) => {
      take(row, 'weak_alias');
    });
  }

  const exact = (item: Found) => [...item.via].some((via) => EXACT_VIA.has(via));
  const ranked = [...found.values()].sort(
    (left, right) =>
      Number(exact(right)) - Number(exact(left)) ||
      right.sharedKeys - left.sharedKeys ||
      right.similarity - left.similarity ||
      left.sourceId.localeCompare(right.sourceId) ||
      left.entryId.localeCompare(right.entryId),
  );
  capReached ||= ranked.length > query.cap;
  return {
    candidates: ranked.slice(0, query.cap).map((item) => ({
      sourceId: item.sourceId,
      entryId: item.entryId,
      sharedKeys: item.sharedKeys,
      via: VIA_ORDER.filter((via) => item.via.has(via)),
    })),
    truncated: capReached || unreachable,
    capReached,
    unreachable,
  };
}

/** A stored normalised record (C77.1) with what matching and the match state machine read. */
export interface WatchlistEntryRecord {
  sourceId: string;
  entryId: string;
  kind: 'individual' | 'entity' | 'vessel' | 'aircraft';
  contentHash: string;
  riskDataHash: string;
  /** The normalised record (C77.1, snake_case). */
  data: Readonly<Record<string, unknown>>;
  /** Set when the entry left its source (C75.8: its open matches become `delisted`). */
  removedAt: Date | null;
}

export interface LoadEntriesQuery {
  environmentKind: EnvironmentKind;
  entries: readonly { sourceId: string; entryId: string }[];
  /**
   * Owner decision 3 after 6B: also one page of the live entries a sync added or changed (its
   * `changed_sync_id`), by entry id after `afterEntryId`, so a `list_update` run screens them beside
   * retrieval.
   */
  changedInSync?: { syncId: number; afterEntryId?: string | undefined; limit: number } | undefined;
}

/**
 * Owner decision 3 after Workflow 6C (`matcher-6d`): the reads' switchable shortcuts, as the
 * matcher's `SCREENING_SHORTCUTS` are, so a benchmark can measure each one's share.
 *
 * - `array-parameters`: `loadEntries` binds the candidates' source ids and entry ids as two
 *   `text[]` parameters a statement, not one parameter per id, so neither drizzle nor the protocol
 *   handles a parameter per candidate.
 */
export const WATCHLIST_READ_SHORTCUTS = ['array-parameters'] as const;
export type WatchlistReadShortcut = (typeof WATCHLIST_READ_SHORTCUTS)[number];

const readShortcuts = new Set<WatchlistReadShortcut>(WATCHLIST_READ_SHORTCUTS);

/** Turns the reads' shortcuts on or off; returns a function that restores the previous state. */
export function useWatchlistReadShortcuts(
  switches: Partial<Readonly<Record<WatchlistReadShortcut, boolean>>>,
): () => void {
  const previous = new Set(readShortcuts);
  for (const shortcut of WATCHLIST_READ_SHORTCUTS) {
    if (switches[shortcut] === true) {
      readShortcuts.add(shortcut);
    } else if (switches[shortcut] === false) {
      readShortcuts.delete(shortcut);
    }
  }
  return () => {
    readShortcuts.clear();
    previous.forEach((shortcut) => readShortcuts.add(shortcut));
  };
}

/** Candidates loaded per statement when their ids are bound as two `text[]` parameters. */
const ARRAY_BATCH = 5_000;

/** C78.3: the entries of the candidates and of a report's live matches, removed ones included. */
export async function loadEntries(
  db: Db,
  query: LoadEntriesQuery,
): Promise<WatchlistEntryRecord[]> {
  const records: WatchlistEntryRecord[] = [];
  const changed = query.changedInSync;
  if (changed !== undefined) {
    const rows = await rowsOf(
      db,
      sql`select ${ENTRY_COLUMNS}
            from watchlist_entries e
            join watchlist_syncs y on y.id = ${changed.syncId} and y.source_id = e.source_id
            join watchlist_sources s on s.id = e.source_id
           where e.changed_sync_id = ${changed.syncId}
             and e.removed_at is null
             ${changed.afterEntryId === undefined ? sql`` : sql`and e.entry_id collate "C" > ${changed.afterEntryId}`}
             ${query.environmentKind === 'sandbox' ? sql`` : sql`and not s.sandbox_only`}
           order by e.entry_id collate "C"
           limit ${changed.limit}`,
    );
    records.push(...rows.map(entryRecord));
  }
  if (query.entries.length === 0) {
    return records;
  }
  const arrays = readShortcuts.has('array-parameters');
  for (const batch of chunks(query.entries, arrays ? ARRAY_BATCH : undefined)) {
    const ids = (pick: (entry: { sourceId: string; entryId: string }) => string) =>
      arrays ? sql`${sql.param(batch.map(pick))}::text[]` : textArray(batch.map(pick));
    const rows = await rowsOf(
      db,
      sql`select ${ENTRY_COLUMNS}
            from watchlist_entries e
            join watchlist_sources s on s.id = e.source_id
           where (e.source_id, e.entry_id) in (
                   select * from unnest(${ids(({ sourceId }) => sourceId)},
                                        ${ids(({ entryId }) => entryId)}))
             ${query.environmentKind === 'sandbox' ? sql`` : sql`and not s.sandbox_only`}`,
    );
    records.push(...rows.map(entryRecord));
  }
  const unique = new Map(
    records.map((record) => [`${record.sourceId}\u0000${record.entryId}`, record]),
  );
  return [...unique.values()].sort(
    (left, right) =>
      left.sourceId.localeCompare(right.sourceId) || left.entryId.localeCompare(right.entryId),
  );
}

/** C76.3, C78.3: a source's state as a run checks it (freshness, configuration, keys version). */
export interface WatchlistSourceState {
  id: string;
  enabled: boolean;
  sandboxOnly: boolean;
  keysVersion: string | null;
  lastSyncId: number | null;
  lastPublishedAt: Date | null;
  lastSha256: string | null;
  lastAppliedAt: Date | null;
  lastCheckedAt: Date | null;
  lastOrigin: 'publisher' | 'import' | null;
  lastErrorCode: string | null;
  /**
   * Owner decision 6 (K6A-11): checks failed since the last good one, and when the last one did;
   * the refresh tick's back-off. Optional, so a hand-built state (tests) may leave them out.
   */
  checkFailures?: number | undefined;
  lastFailedAt?: Date | null | undefined;
  /**
   * Owner decision 13 after 6B (K6A-9): the scripts the source's live names are written in, so
   * coverage says `lossy_script` from the source rather than from the candidates of one run.
   * Optional: a hand-built state may leave it out. Read from the `#script:<script>` rows of the
   * key frequencies (`watchlist-key-df.ts`) by exact key, so it costs a few index lookups.
   */
  scripts?: readonly string[] | undefined;
}

/** The `#script:<script>` keys of every writing system a list name may hold. */
const SCRIPT_KEYS = LIST_NAME_SCRIPTS.map((script) => `${WATCHLIST_SCRIPT_KEY_PREFIX}${script}`);

/** C76.3: the states of `sourceIds` (a source without a row is left out: never synced, unknown). */
export async function getWatchlistSourceStates(
  db: Db,
  sourceIds: readonly string[],
): Promise<WatchlistSourceState[]> {
  if (sourceIds.length === 0) {
    return [];
  }
  const rows = await rowsOf(
    db,
    sql`select ${SOURCE_COLUMNS},
               array(select substr(d.key, ${WATCHLIST_SCRIPT_KEY_PREFIX.length + 1})
                       from watchlist_key_df d
                      where d.source_id = watchlist_sources.id
                        and d.key = any(${textArray(SCRIPT_KEYS)})
                      order by d.key) as scripts
          from watchlist_sources
         where id = any(${textArray(sourceIds)}) order by id`,
  );
  return rows.map((row) => ({
    ...sourceState(row),
    scripts: Array.isArray(row.scripts) ? row.scripts.map(String) : [],
  }));
}

/** The frozen reads, as one injectable object (the run framework takes it; tests pass the fake). */
export interface WatchlistReads {
  retrieveCandidates: typeof retrieveCandidates;
  loadEntries: typeof loadEntries;
  getWatchlistSourceStates: typeof getWatchlistSourceStates;
}

/** The reads over the database. */
export const DB_WATCHLIST_READS: WatchlistReads = Object.freeze({
  retrieveCandidates,
  loadEntries,
  getWatchlistSourceStates,
});
