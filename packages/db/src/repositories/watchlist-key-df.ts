/**
 * C78.3: the key frequencies (`watchlist_key_df`) that candidate retrieval reads to keep only the
 * rare keys. The sync and the re-key rebuild them after their writes. A key's count is the number
 * of live entries whose strong names hold it (owner decision 1 after 6B): the candidate cap counts
 * entries, so a key's count is the most candidates it alone can return.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { chunks, rowsOf } from './watchlist-rows.js';

/** The reserved `watchlist_key_df` key that holds the source's count of strong live names. */
export const WATCHLIST_NAME_COUNT_KEY = '#names';

/**
 * Owner decision 13 after 6B (K6A-9): the reserved keys `#script:<script>` that hold, per script,
 * the source's count of live names written in it (weak aliases included), which coverage reads
 * (C78.5: whether any entry of the source carries the subject's script).
 */
export const WATCHLIST_SCRIPT_KEY_PREFIX = '#script:';

/**
 * C78.3: rebuilds the source's key frequencies over its live entries' strong names, the count of
 * its live strong names (`#names`) and of its live names per script (`#script:<script>`), and
 * empties the pending lists of the names' GIN indexes.
 */
export async function rebuildWatchlistKeyDf(db: Db, sourceId: string): Promise<void> {
  // The sync writes the source's entries and names in the same transaction, which no autovacuum
  // has analysed: without fresh statistics the planner joins 100,000 names to their entries in a
  // nested loop and the rebuild takes minutes (C78.7 gate). ANALYZE sees this transaction's rows.
  await db.execute(sql`analyze watchlist_entries, watchlist_names`);
  await db.execute(sql`delete from watchlist_key_df where source_id = ${sourceId}`);
  const live = sql`from watchlist_names n
    join watchlist_entries e on e.source_id = n.source_id and e.entry_id = n.entry_id
   where n.source_id = ${sourceId} and n.quality = 'strong' and e.removed_at is null`;
  await db.execute(sql`
    insert into watchlist_key_df (source_id, key, count)
    select ${sourceId}, k.key, count(distinct n.entry_id)::int
      from watchlist_names n
      join watchlist_entries e on e.source_id = n.source_id and e.entry_id = n.entry_id
      cross join lateral unnest(n.keys) as k(key)
     where n.source_id = ${sourceId} and n.quality = 'strong' and e.removed_at is null
     group by k.key
    having count(distinct n.entry_id) > 1`);
  await db.execute(sql`
    insert into watchlist_key_df (source_id, key, count)
    select ${sourceId}, ${WATCHLIST_NAME_COUNT_KEY}, count(*)::int ${live}
    having count(*) > 0`);
  await db.execute(sql`
    insert into watchlist_key_df (source_id, key, count)
    select ${sourceId}, ${WATCHLIST_SCRIPT_KEY_PREFIX} || n.script::text, count(*)::int
      from watchlist_names n
      join watchlist_entries e on e.source_id = n.source_id and e.entry_id = n.entry_id
     where n.source_id = ${sourceId} and e.removed_at is null
     group by n.script`);
  // Owner decision 1 after 6B: the names just written wait in the pending lists of the key and
  // trigram indexes until autovacuum, and every probe reads a whole pending list (up to 4 MB) and
  // is priced up by it, which turns the planner to scans; they are moved into the indexes now
  // (development tables: retrieval p95 148.5 ms against 52.9 ms at 100,000 names).
  // C249.3 (Workflow 11B): gin_clean_pending_list needs the index's owner, so the runtime role runs
  // it through the migration role's SECURITY DEFINER function (migration 0036).
  await cleanWatchlistGinPendingLists(db, sourceId);
}

/**
 * Owner decision 3 after 6B: how many live entries of the source hold each of `keys` (a key that
 * no entry or one entry holds is left out), so the re-screen keys each subject as its own search
 * would. Owner decision 4 after 6C: each statement binds its keys as one `text[]` parameter, so
 * neither drizzle nor the protocol handles a parameter per key.
 */
export async function watchlistKeyFrequencies(
  db: Db,
  sourceId: string,
  keys: readonly string[],
): Promise<Map<string, number>> {
  const frequencies = new Map<string, number>();
  for (const batch of chunks([...new Set(keys)], KEY_BATCH)) {
    const rows = await rowsOf(
      db,
      sql`select key, count from watchlist_key_df
           where source_id = ${sourceId} and key = any(${sql.param(batch)}::text[])`,
    );
    rows.forEach((row) => frequencies.set(String(row.key), Number(row.count)));
  }
  return frequencies;
}

/**
 * Owner decision 4 after 6C: the source's whole frequency table (every key two or more live entries
 * hold, and the reserved counts), read in one statement, so a re-screen keys every subject from one
 * consistent set; `null`, reading nothing more, when the source holds more than `atMost` rows.
 */
export async function watchlistKeyFrequencyTable(
  db: Db,
  sourceId: string,
  atMost: number,
): Promise<Map<string, number> | null> {
  const [size] = await rowsOf(
    db,
    sql`select count(*)::int as rows from watchlist_key_df where source_id = ${sourceId}`,
  );
  if (Number(size?.rows ?? 0) > atMost) {
    return null;
  }
  const rows = await rowsOf(
    db,
    sql`select key, count from watchlist_key_df where source_id = ${sourceId}`,
  );
  return new Map(rows.map((row) => [String(row.key), Number(row.count)]));
}

/**
 * C270.3 (Workflow 11D, matcher-write-11d): the GIN pending-list limit, in kB, for the rest of the
 * caller's transaction (`set_config(…, true)`, a `SET LOCAL` the runtime role may run; an index's
 * own storage parameter, which only its owner may set, would win over it).
 */
export async function setWatchlistGinPendingListLimit(db: Db, kilobytes: number): Promise<void> {
  await db.execute(sql`select set_config(${'gin_pending_list_limit'}, ${String(kilobytes)}, true)`);
}

/**
 * C270.3, owner decision 1 after 6B: moves what the names' GIN indexes hold pending into the
 * indexes, through the migration role's SECURITY DEFINER function (C249.3, migration 0036), which
 * cleans `watchlist_names_keys_idx` and `watchlist_names_normalised_trgm_idx` whatever the source.
 */
export async function cleanWatchlistGinPendingLists(db: Db, sourceId: string): Promise<void> {
  await db.execute(sql`select openverify_gin_clean_pending_lists(${sourceId})`);
}

/** C270.1: how many frequency rows the source holds (`watchlists:rebuild-key-df`'s line). */
export async function countWatchlistKeyDfRows(db: Db, sourceId: string): Promise<number> {
  const [row] = await rowsOf(
    db,
    sql`select count(*)::int as keys from watchlist_key_df where source_id = ${sourceId}`,
  );
  return Number(row?.keys ?? 0);
}

/** Keys read per statement, bound as one `text[]` parameter. */
const KEY_BATCH = 20_000;

/**
 * C270.1 (Workflow 11D, matcher-write-11d): one key's share of some live entries, as
 * {@link rebuildWatchlistKeyDf} counts it: a name key counts the entries whose strong names hold
 * it; a reserved key (`#names`, `#script:<script>`) counts names.
 */
export interface WatchlistKeyDfShare {
  reserved: boolean;
  count: number;
}

/** C270.1: records the effect of the sync's writes on the key frequencies and applies it. */
export interface WatchlistKeyDfTracker {
  /** Runs `change`, which writes or removes `entryIds`, and records its effect. */
  track<T>(entryIds: readonly string[], change: () => Promise<T>): Promise<T>;
  /** Applies what is recorded and not yet applied, then empties the GIN pending lists. */
  finish(): Promise<void>;
}

/** Rows of a name key: none below this count (a key one entry holds needs no row). */
const NAME_KEY_FLOOR = 2;
/** Rows of a reserved key: none below this count. */
const RESERVED_KEY_FLOOR = 1;
/** C270.1: the tracker applies its delta once it holds this many keys, so its memory is bounded. */
export const WATCHLIST_KEY_DF_APPLY_KEYS = 50_000;

const textParam = (values: readonly string[]) => sql`${sql.param([...values])}::text[]`;
const intParam = (values: readonly number[]) => sql`${sql.param([...values])}::int[]`;

/**
 * C270.1 (Workflow 11D, matcher-write-11d): what the live entries `entryIds` of the source add to
 * its key frequencies, by the rules of {@link rebuildWatchlistKeyDf}: each name key once per entry
 * whose strong names hold it, `#names` per strong name and `#script:<script>` per name. A removed
 * entry adds nothing. The shares of several entries add up, so the frequencies of a state are the
 * sum of its live entries' shares.
 */
export async function watchlistKeyDfShares(
  db: Db,
  sourceId: string,
  entryIds: readonly string[],
): Promise<Map<string, WatchlistKeyDfShare>> {
  const shares = new Map<string, WatchlistKeyDfShare>();
  for (const batch of chunks([...new Set(entryIds)], KEY_BATCH)) {
    const rows = await rowsOf(
      db,
      sql`with live as (
            select n.entry_id, n.keys, n.quality, n.script
              from watchlist_names n
              join watchlist_entries e on e.source_id = n.source_id and e.entry_id = n.entry_id
             where n.source_id = ${sourceId} and n.entry_id = any(${textParam(batch)})
               and e.removed_at is null)
          select k.key, count(distinct live.entry_id)::int as count, false as reserved
            from live cross join lateral unnest(live.keys) as k(key)
           where live.quality = 'strong'
           group by k.key
          union all
          select ${WATCHLIST_NAME_COUNT_KEY}, count(*)::int, true from live
           where live.quality = 'strong' having count(*) > 0
          union all
          select ${WATCHLIST_SCRIPT_KEY_PREFIX} || live.script::text, count(*)::int, true
            from live group by live.script`,
    );
    for (const row of rows) {
      const key = String(row.key);
      shares.set(key, {
        reserved: row.reserved === true,
        count: (shares.get(key)?.count ?? 0) + Number(row.count),
      });
    }
  }
  return shares;
}

/**
 * C270.1: applies a change of the frequencies (each key's count after the change less its count
 * before) to a table that was exact before it, so it is exact after it, as a rebuild would leave
 * it. A key with a row takes its count plus the change and loses the row below its floor (2 for a
 * name key, 1 for a reserved key); a reserved key without a row held 0, so it gains a row of the
 * change; a name key without a row held 0 or 1, so it is counted again over the live entries, which
 * reads only the names that hold it.
 */
export async function applyWatchlistKeyDfDelta(
  db: Db,
  sourceId: string,
  delta: ReadonlyMap<string, WatchlistKeyDfShare>,
): Promise<void> {
  const changed = [...delta].filter(([, share]) => share.count !== 0);
  for (const batch of chunks(changed, KEY_BATCH)) {
    const present = new Map(
      (
        await rowsOf(
          db,
          sql`select key, count from watchlist_key_df
               where source_id = ${sourceId} and key = any(${textParam(batch.map(([key]) => key))})`,
        )
      ).map((row) => [String(row.key), Number(row.count)]),
    );
    const deleted: string[] = [];
    const updated: [string, number][] = [];
    const inserted: [string, number][] = [];
    const recounted: string[] = [];
    for (const [key, share] of batch) {
      const current = present.get(key);
      if (current !== undefined) {
        const next = current + share.count;
        if (next < (share.reserved ? RESERVED_KEY_FLOOR : NAME_KEY_FLOOR)) {
          deleted.push(key);
        } else {
          updated.push([key, next]);
        }
      } else if (share.count > 0) {
        if (share.reserved) {
          inserted.push([key, share.count]);
        } else {
          recounted.push(key);
        }
      }
    }
    if (deleted.length > 0) {
      await db.execute(
        sql`delete from watchlist_key_df
             where source_id = ${sourceId} and key = any(${textParam(deleted)})`,
      );
    }
    if (updated.length > 0) {
      await db.execute(
        sql`update watchlist_key_df k set count = v.count
              from unnest(${textParam(updated.map(([key]) => key))},
                          ${intParam(updated.map(([, count]) => count))}) as v(key, count)
             where k.source_id = ${sourceId} and k.key = v.key`,
      );
    }
    if (inserted.length > 0) {
      await db.execute(
        sql`insert into watchlist_key_df (source_id, key, count)
            select ${sourceId}, v.key, v.count
              from unnest(${textParam(inserted.map(([key]) => key))},
                          ${intParam(inserted.map(([, count]) => count))}) as v(key, count)`,
      );
    }
    if (recounted.length > 0) {
      await db.execute(
        sql`with wanted as (select unnest(${textParam(recounted)}) as key)
            insert into watchlist_key_df (source_id, key, count)
            select n.source_id, k.key, count(distinct n.entry_id)::int
              from watchlist_names n
              join watchlist_entries e on e.source_id = n.source_id and e.entry_id = n.entry_id
              cross join lateral unnest(n.keys) as k(key)
              join wanted w on w.key = k.key
             where n.source_id = ${sourceId} and n.quality = 'strong' and e.removed_at is null
               and n.keys && (select array_agg(key) from wanted)
             group by n.source_id, k.key
            having count(distinct n.entry_id) >= ${NAME_KEY_FLOOR}`,
      );
    }
  }
}

/**
 * C270.1: a tracker of one sync's changes to the source, inside the sync's transaction under the
 * source's lock. Each `track` reads the shares of the entries a change writes or removes before
 * and after it and keeps the difference; the difference is applied once it holds `applyAtKeys`
 * keys and when the tracker finishes, which then empties the GIN pending lists as the rebuild does.
 * The table must be exact when the tracker starts (every sync leaves it so; a full rebuild with
 * `watchlists:rebuild-key-df` restores it).
 */
export function trackWatchlistKeyDf(
  db: Db,
  sourceId: string,
  options: { applyAtKeys?: number } = {},
): WatchlistKeyDfTracker {
  const applyAtKeys = options.applyAtKeys ?? WATCHLIST_KEY_DF_APPLY_KEYS;
  let delta = new Map<string, WatchlistKeyDfShare>();
  const add = (shares: ReadonlyMap<string, WatchlistKeyDfShare>, sign: 1 | -1) => {
    for (const [key, share] of shares) {
      const count = (delta.get(key)?.count ?? 0) + sign * share.count;
      if (count === 0) {
        delta.delete(key);
      } else {
        delta.set(key, { reserved: share.reserved, count });
      }
    }
  };
  const apply = async () => {
    if (delta.size > 0) {
      const applying = delta;
      delta = new Map();
      await applyWatchlistKeyDfDelta(db, sourceId, applying);
    }
  };
  return {
    async track<T>(entryIds: readonly string[], change: () => Promise<T>): Promise<T> {
      if (entryIds.length === 0) {
        return change();
      }
      const before = await watchlistKeyDfShares(db, sourceId, entryIds);
      const result = await change();
      add(before, -1);
      add(await watchlistKeyDfShares(db, sourceId, entryIds), 1);
      if (delta.size >= applyAtKeys) {
        await apply();
      }
      return result;
    },
    async finish(): Promise<void> {
      await apply();
      // As the rebuild ends (owner decision 1 after 6B; C249.3): the names just written are moved
      // out of the GIN pending lists through the migration role's function.
      await cleanWatchlistGinPendingLists(db, sourceId);
    },
  };
}
