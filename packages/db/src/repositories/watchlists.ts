/**
 * C76: the watchlist sync's writes (entries, names, keys, identifiers, crypto addresses, source rows
 * and the `watchlist_syncs` audit), the re-key's pages, the removed-entry purge and the source
 * locks. The frozen reads that screening uses are in `watchlist-reads.ts`, the key frequencies in
 * `watchlist-key-df.ts`, and the sources page's reads of the report tables in `report-templates.ts`
 * and `reports.ts`.
 *
 * List data is public but personal (C73.3): every value bound here is a query parameter, and
 * Postgres is started without bind-parameter logging (C73.8), so no screened name or list entry
 * reaches a server log. Nothing here logs.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { WatchlistEntryRecord, WatchlistSourceState } from './watchlist-reads.js';
import {
  bigintArray,
  chunks,
  dateOf,
  ENTRY_COLUMNS,
  entryRecord,
  rowsOf,
  SOURCE_COLUMNS,
  sourceState,
  stringOf,
  textArray,
  type Row,
} from './watchlist-rows.js';

// Source rows (C76.2-C76.4) ---------------------------------------------------------------------

/** C76.4: one manifest source as the reconciliation writes it. */
export interface ReconciledWatchlistSource {
  id: string;
  enabled: boolean;
  sandboxOnly: boolean;
}

/** C76.4: what the reconciliation wrote; counts only. */
export interface ReconciledWatchlistSources {
  sources: number;
  enabled: number;
  /** Rows of sources the manifest no longer lists, kept disabled. */
  retired: number;
}

/**
 * C76.4 (V01): upserts one row per manifest source (`enabled`, `sandbox_only`) and disables every
 * other row, which stays for history. Nothing else writes `enabled`.
 */
export async function reconcileWatchlistSourceRows(
  db: Db,
  sources: readonly ReconciledWatchlistSource[],
): Promise<ReconciledWatchlistSources> {
  if (sources.length > 0) {
    await db.execute(sql`
      insert into watchlist_sources (id, enabled, sandbox_only)
      values ${sql.join(
        sources.map((source) => sql`(${source.id}, ${source.enabled}, ${source.sandboxOnly})`),
        sql`, `,
      )}
      on conflict (id) do update
        set enabled = excluded.enabled, sandbox_only = excluded.sandbox_only, updated_at = now()
        where watchlist_sources.enabled is distinct from excluded.enabled
           or watchlist_sources.sandbox_only is distinct from excluded.sandbox_only`);
  }
  const ids = textArray(sources.map(({ id }) => id));
  await db.execute(sql`
    update watchlist_sources set enabled = false, updated_at = now()
     where enabled and not (id = any(${ids}))`);
  const retired = await rowsOf<{ count: number }>(
    db,
    sql`select count(*)::int as count from watchlist_sources where not (id = any(${ids}))`,
  );
  return {
    sources: sources.length,
    enabled: sources.filter((source) => source.enabled).length,
    retired: retired[0]?.count ?? 0,
  };
}

/** Every source row, by id (the sources page). */
export async function listWatchlistSourceStates(db: Db): Promise<WatchlistSourceState[]> {
  return (await rowsOf(db, sql`select ${SOURCE_COLUMNS} from watchlist_sources order by id`)).map(
    sourceState,
  );
}

/** C76.2: the source row under `FOR UPDATE`, inside the apply transaction; `null` without a row. */
export async function lockWatchlistSourceRow(
  db: Db,
  sourceId: string,
): Promise<WatchlistSourceState | null> {
  const rows = await rowsOf(
    db,
    sql`select ${SOURCE_COLUMNS} from watchlist_sources where id = ${sourceId} for update`,
  );
  const [row] = rows;
  return row === undefined ? null : sourceState(row);
}

/** C76.3: a successful check (`applied` or `unchanged`): `last_checked_at`, the error cleared. */
export async function recordWatchlistSourceCheck(
  db: Db,
  input: { sourceId: string; at: Date },
): Promise<void> {
  await db.execute(sql`
    update watchlist_sources
       set last_checked_at = ${input.at.toISOString()}::timestamptz, last_error_code = null,
           check_failures = 0, last_failed_at = null, updated_at = now()
     where id = ${input.sourceId}`);
}

/**
 * C76.2: a source's last error code (`source_not_configured`, a refusal, a download error). With
 * `failedAt`, the check itself failed after asking the publisher or reading its file (a download
 * error or a refusal): it counts toward the refresh back-off (owner decision 6, K6A-11).
 */
export async function recordWatchlistSourceError(
  db: Db,
  input: { sourceId: string; code: string; failedAt?: Date | undefined },
): Promise<void> {
  const failure =
    input.failedAt === undefined
      ? sql``
      : sql`, check_failures = check_failures + 1,
             last_failed_at = ${input.failedAt.toISOString()}::timestamptz`;
  await db.execute(sql`
    update watchlist_sources set last_error_code = ${input.code}${failure}, updated_at = now()
     where id = ${input.sourceId}`);
}

/** C76.2 step 6: the source after an applied sync (provenance, the check, the keys version). */
export interface AppliedWatchlistSource {
  sourceId: string;
  syncId: number;
  publishedAt: Date;
  sha256: string;
  at: Date;
  origin: 'publisher' | 'import';
  keysVersion: string;
}

export async function recordWatchlistSourceApplied(
  db: Db,
  input: AppliedWatchlistSource,
): Promise<void> {
  const at = input.at.toISOString();
  await db.execute(sql`
    update watchlist_sources
       set last_sync_id = ${input.syncId}, last_published_at = ${input.publishedAt.toISOString()}::timestamptz,
           last_sha256 = ${input.sha256}, last_applied_at = ${at}::timestamptz,
           last_checked_at = ${at}::timestamptz, last_origin = ${input.origin},
           keys_version = ${input.keysVersion}, last_error_code = null, check_failures = 0,
           last_failed_at = null, updated_at = now()
     where id = ${input.sourceId}`);
}

/** C78.3: the keys version a re-key leaves on the source. */
export async function setWatchlistSourceKeysVersion(
  db: Db,
  input: { sourceId: string; keysVersion: string },
): Promise<void> {
  await db.execute(sql`
    update watchlist_sources set keys_version = ${input.keysVersion}, updated_at = now()
     where id = ${input.sourceId}`);
}

// The audit (C73.3) -----------------------------------------------------------------------------

export type WatchlistSyncOutcome =
  | 'applied'
  | 'unchanged'
  | 'rekeyed'
  | 'busy'
  | 'refused_rollback'
  | 'refused_future'
  | 'refused_mass_removal'
  | 'refused_schema'
  | 'refused_size'
  | 'refused_matcher_data'
  | 'error';

/** C73.3: one `watchlist_syncs` row. */
export interface WatchlistSyncInput {
  sourceId: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: WatchlistSyncOutcome;
  publishedAt?: Date | null;
  sha256?: string | null;
  entryCount?: number;
  added?: number;
  changed?: number;
  removed?: number;
  actor: 'cli' | 'job' | 'seed';
  origin?: 'publisher' | 'import' | null;
  override?: 'allow-mass-removal' | 'accept-older-publication' | 'allow-normalised' | null;
  keysVersion?: string | null;
  rescreenState?: 'none' | 'pending' | 'done';
}

export interface WatchlistSync extends Required<Omit<WatchlistSyncInput, 'rescreenState'>> {
  id: number;
  rescreenState: 'none' | 'pending' | 'done';
  rescreenEnqueuedAt: Date | null;
}

const SYNC_COLUMNS = sql`id, source_id as "sourceId", started_at as "startedAt",
  finished_at as "finishedAt", outcome, published_at as "publishedAt", sha256,
  entry_count as "entryCount", added, changed, removed, actor, origin, override,
  keys_version as "keysVersion", rescreen_state as "rescreenState",
  rescreen_enqueued_at as "rescreenEnqueuedAt"`;

function syncRow(row: Row): WatchlistSync {
  return {
    id: Number(row.id),
    sourceId: String(row.sourceId),
    startedAt: dateOf(row.startedAt) ?? new Date(0),
    finishedAt: dateOf(row.finishedAt),
    outcome: String(row.outcome) as WatchlistSyncOutcome,
    publishedAt: dateOf(row.publishedAt),
    sha256: stringOf(row.sha256),
    entryCount: Number(row.entryCount),
    added: Number(row.added),
    changed: Number(row.changed),
    removed: Number(row.removed),
    actor: String(row.actor) as WatchlistSync['actor'],
    origin: stringOf(row.origin) as WatchlistSync['origin'],
    override: stringOf(row.override) as WatchlistSync['override'],
    keysVersion: stringOf(row.keysVersion),
    rescreenState: String(row.rescreenState) as WatchlistSync['rescreenState'],
    rescreenEnqueuedAt: dateOf(row.rescreenEnqueuedAt),
  };
}

const timestamp = (value: Date | null | undefined): SQL =>
  value === null || value === undefined ? sql`null` : sql`${value.toISOString()}::timestamptz`;

/** C73.3: writes one audit row; returns its id. */
export async function insertWatchlistSync(db: Db, input: WatchlistSyncInput): Promise<number> {
  const rows = await rowsOf<{ id: number | string }>(
    db,
    sql`insert into watchlist_syncs (source_id, started_at, finished_at, outcome, published_at,
          sha256, entry_count, added, changed, removed, actor, origin, override, keys_version,
          rescreen_state)
        values (${input.sourceId}, ${timestamp(input.startedAt)}, ${timestamp(input.finishedAt)},
          ${input.outcome}, ${timestamp(input.publishedAt)}, ${input.sha256 ?? null},
          ${input.entryCount ?? 0}, ${input.added ?? 0}, ${input.changed ?? 0},
          ${input.removed ?? 0}, ${input.actor}, ${input.origin ?? null}, ${input.override ?? null},
          ${input.keysVersion ?? null}, ${input.rescreenState ?? 'none'})
        returning id`,
  );
  return Number(rows[0]?.id);
}

/** C76.2 step 6: what an applied sync's row records once its transaction has written the entries. */
export interface FinishedWatchlistSync {
  finishedAt: Date;
  publishedAt: Date | null;
  sha256: string | null;
  entryCount: number;
  added: number;
  changed: number;
  removed: number;
  override: WatchlistSyncInput['override'];
  rescreenState: 'none' | 'pending';
}

/** C76.2 step 6: completes the row an apply transaction inserted first (the entries need its id). */
export async function finishWatchlistSync(
  db: Db,
  id: number,
  input: FinishedWatchlistSync,
): Promise<void> {
  await db.execute(sql`
    update watchlist_syncs
       set finished_at = ${timestamp(input.finishedAt)}, published_at = ${timestamp(input.publishedAt)},
           sha256 = ${input.sha256}, entry_count = ${input.entryCount}, added = ${input.added},
           changed = ${input.changed}, removed = ${input.removed}, override = ${input.override ?? null},
           rescreen_state = ${input.rescreenState}
     where id = ${id}`);
}

export async function getWatchlistSync(db: Db, id: number): Promise<WatchlistSync | null> {
  const [row] = await rowsOf(db, sql`select ${SYNC_COLUMNS} from watchlist_syncs where id = ${id}`);
  return row === undefined ? null : syncRow(row);
}

/** The newest syncs, newest first (the sources page). */
export async function listRecentWatchlistSyncs(db: Db, limit: number): Promise<WatchlistSync[]> {
  return (
    await rowsOf(
      db,
      sql`select ${SYNC_COLUMNS} from watchlist_syncs
           order by started_at desc, id desc limit ${limit}`,
    )
  ).map(syncRow);
}

/**
 * C74.3 (c), V05: the applied syncs whose re-screen is still `pending` and whose last enqueue is
 * older than `enqueuedBefore` (or never), oldest first.
 */
export async function listPendingRescreenSyncs(
  db: Db,
  input: { enqueuedBefore: Date; limit: number },
): Promise<{ id: number; sourceId: string }[]> {
  const rows = await rowsOf(
    db,
    sql`select id, source_id as "sourceId" from watchlist_syncs
         where rescreen_state = 'pending'
           and (rescreen_enqueued_at is null
                or rescreen_enqueued_at < ${input.enqueuedBefore.toISOString()}::timestamptz)
         order by id limit ${input.limit}`,
  );
  return rows.map((row) => ({ id: Number(row.id), sourceId: String(row.sourceId) }));
}

/** C74.4: the re-screen of these syncs was enqueued at `at`. */
export async function markRescreensEnqueued(
  db: Db,
  input: { syncIds: readonly number[]; at: Date },
): Promise<void> {
  if (input.syncIds.length === 0) {
    return;
  }
  await db.execute(sql`
    update watchlist_syncs set rescreen_enqueued_at = ${input.at.toISOString()}::timestamptz
     where id = any(${bigintArray(input.syncIds)}) and rescreen_state = 'pending'`);
}

/** C74.4: the re-screen of a sync ran in every environment. */
export async function markRescreenDone(db: Db, syncId: number): Promise<void> {
  await db.execute(sql`
    update watchlist_syncs set rescreen_state = 'done'
     where id = ${syncId} and rescreen_state = 'pending'`);
}

// Entries and their derived rows (C76.2 step 6, C78.3) -----------------------------------------

/** A name row as the sync writes it (`recordNameRows` of `@openverify/watchlist`). */
export interface WatchlistNameRowInput {
  ordinal: number;
  name: string;
  normalised: string;
  script: string;
  quality: 'strong' | 'weak';
  primary: boolean;
  keys: readonly string[];
}

/** An identifier row (`recordIdentifierRows`). */
export interface WatchlistIdentifierRowInput {
  kind: string;
  value: string;
  country: string | null;
}

/** A crypto address row (`recordCryptoRows`). */
export interface WatchlistCryptoRowInput {
  chain: string;
  canonical: string;
  raw: string;
  ticker: string | null;
}

/** The derived rows of one entry, all built with one keys version. */
export interface WatchlistEntryParts {
  entryId: string;
  names: readonly WatchlistNameRowInput[];
  identifiers: readonly WatchlistIdentifierRowInput[];
  cryptoAddresses: readonly WatchlistCryptoRowInput[];
}

/** One record of a publication, classified by the diff (C77.6). */
export interface WatchlistEntryWrite extends WatchlistEntryParts {
  kind: WatchlistEntryRecord['kind'];
  contentHash: string;
  riskDataHash: string;
  data: Readonly<Record<string, unknown>>;
  programs: readonly string[];
  listedAt: string | null;
  /** `added` also covers an entry listed again after its removal. */
  change: 'added' | 'changed' | 'unchanged';
  contentChanged: boolean;
  riskDataChanged: boolean;
}

/** C77.6: the source's entries not yet removed, with their hashes. */
export async function loadLiveEntryHashes(
  db: Db,
  sourceId: string,
): Promise<Map<string, { contentHash: string; riskDataHash: string }>> {
  const rows = await rowsOf(
    db,
    sql`select entry_id as "entryId", content_hash as "contentHash",
               risk_data_hash as "riskDataHash"
          from watchlist_entries where source_id = ${sourceId} and removed_at is null`,
  );
  return new Map(
    rows.map((row) => [
      String(row.entryId),
      { contentHash: String(row.contentHash), riskDataHash: String(row.riskDataHash) },
    ]),
  );
}

/** Replaces the names, identifiers and crypto addresses of `entries`. */
async function replaceParts(
  db: Db,
  sourceId: string,
  entries: readonly WatchlistEntryParts[],
): Promise<void> {
  for (const batch of chunks(entries)) {
    const ids = textArray(batch.map(({ entryId }) => entryId));
    for (const table of [
      'watchlist_names',
      'watchlist_identifiers',
      'watchlist_crypto_addresses',
    ]) {
      await db.execute(
        sql`delete from ${sql.identifier(table)} where source_id = ${sourceId} and entry_id = any(${ids})`,
      );
    }
    const names = batch.flatMap(({ entryId, names: rows }) =>
      rows.map(
        (row) =>
          sql`(${sourceId}, ${entryId}, ${row.ordinal}, ${row.name}, ${row.normalised},
               ${row.script}, ${row.quality}, ${row.primary}, ${textArray(row.keys)})`,
      ),
    );
    for (const values of chunks(names)) {
      await db.execute(sql`
        insert into watchlist_names (source_id, entry_id, ordinal, name, normalised, script,
          quality, "primary", keys)
        values ${sql.join(values, sql`, `)}`);
    }
    const identifiers = batch.flatMap(({ entryId, identifiers: rows }) =>
      rows.map(
        (row, ordinal) =>
          sql`(${sourceId}, ${entryId}, ${ordinal}, ${row.kind}, ${row.value}, ${row.country})`,
      ),
    );
    for (const values of chunks(identifiers)) {
      await db.execute(sql`
        insert into watchlist_identifiers (source_id, entry_id, ordinal, kind, value_normalised,
          country)
        values ${sql.join(values, sql`, `)}`);
    }
    const crypto = batch.flatMap(({ entryId, cryptoAddresses: rows }) =>
      rows.map(
        (row, ordinal) =>
          sql`(${sourceId}, ${entryId}, ${ordinal}, ${row.chain}, ${row.canonical}, ${row.raw},
               ${row.ticker})`,
      ),
    );
    for (const values of chunks(crypto)) {
      await db.execute(sql`
        insert into watchlist_crypto_addresses (source_id, entry_id, ordinal, chain, canonical,
          raw, ticker)
        values ${sql.join(values, sql`, `)}`);
    }
  }
}

/**
 * C76.2 step 6: writes one batch of a publication. An added or changed entry is upserted (listed
 * again: `removed_at` cleared), its `changed_sync_id` set; an entry whose content changed, or that
 * is added, gets its names, identifiers and crypto addresses replaced, and its `last_seen_sync_id`
 * becomes the sync. An unchanged entry is not written at all: rewriting every row of a source on
 * each sync left 412,549 live entries in 3.0 GB of table (evaluation-6). Removals come from the
 * sync's diff instead ({@link markEntriesRemoved}).
 */
export async function writeWatchlistEntries(
  db: Db,
  input: { sourceId: string; syncId: number; entries: readonly WatchlistEntryWrite[] },
): Promise<void> {
  const { sourceId, syncId } = input;
  const written = input.entries.filter((entry) => entry.change !== 'unchanged');
  for (const batch of chunks(written)) {
    await db.execute(sql`
      insert into watchlist_entries (source_id, entry_id, kind, content_hash, risk_data_hash, data,
        programs, listed_at, first_seen_sync_id, last_seen_sync_id, changed_sync_id, removed_at)
      values ${sql.join(
        batch.map(
          (entry) =>
            sql`(${sourceId}, ${entry.entryId}, ${entry.kind}, ${entry.contentHash},
                 ${entry.riskDataHash}, ${JSON.stringify(entry.data)}::jsonb,
                 ${textArray(entry.programs)}, ${entry.listedAt}, ${syncId}, ${syncId}, ${syncId},
                 null)`,
        ),
        sql`, `,
      )}
      on conflict (source_id, entry_id) do update
        set kind = excluded.kind, content_hash = excluded.content_hash,
            risk_data_hash = excluded.risk_data_hash, data = excluded.data,
            programs = excluded.programs, listed_at = excluded.listed_at,
            last_seen_sync_id = excluded.last_seen_sync_id,
            changed_sync_id = excluded.changed_sync_id, removed_at = null`);
  }
  await replaceParts(db, sourceId, written.filter(rewritesParts));
}

/** An added entry, or a changed one whose content changed, gets its names and parts replaced. */
const rewritesParts = (entry: WatchlistEntryWrite): boolean =>
  entry.change !== 'unchanged' && (entry.change === 'added' || entry.contentChanged);

/**
 * C270.1: the entries of a batch whose names {@link writeWatchlistEntries} replaces (an added entry,
 * a re-listed one, a changed one whose content changed), the only ones whose key frequencies a
 * write can move.
 */
export function rewrittenWatchlistEntryIds(entries: readonly WatchlistEntryWrite[]): string[] {
  return entries.filter(rewritesParts).map((entry) => entry.entryId);
}

/**
 * C76.2: the live entries the publication no longer holds (the sync's diff, read under the source's
 * lock) are removed at `at`; returns how many.
 */
export async function markEntriesRemoved(
  db: Db,
  input: { sourceId: string; entryIds: readonly string[]; at: Date },
): Promise<number> {
  let removed = 0;
  for (const batch of chunks(input.entryIds)) {
    const rows = await rowsOf(
      db,
      sql`update watchlist_entries set removed_at = ${input.at.toISOString()}::timestamptz
           where source_id = ${input.sourceId} and removed_at is null
             and entry_id = any(${textArray(batch)})
          returning entry_id`,
    );
    removed += rows.length;
  }
  return removed;
}

/**
 * C76.2, C78.7: refreshes the planner statistics of the list tables inside the sync's transaction
 * (ANALYZE sees its own uncommitted rows). Statistics taken before a source's first import say the
 * source holds no entry, so the planner checks each new name's foreign key through the
 * `(source_id, removed_at)` index and reads every entry of the source per row: a 100,000-name
 * import then took over ten minutes. The sync calls this as its writes grow (C78.7 gate).
 */
export async function analyzeWatchlistTables(db: Db): Promise<void> {
  await db.execute(
    sql`analyze watchlist_entries, watchlist_names, watchlist_identifiers, watchlist_crypto_addresses`,
  );
}

/** C76.8: deletes entries removed before `before` (their parts go with them); returns how many. */
export async function purgeRemovedWatchlistEntries(
  db: Db,
  input: { before: Date; sourceId?: string | undefined },
): Promise<number> {
  const rows = await rowsOf(
    db,
    sql`delete from watchlist_entries
         where removed_at is not null and removed_at < ${input.before.toISOString()}::timestamptz
           ${input.sourceId === undefined ? sql`` : sql`and source_id = ${input.sourceId}`}
        returning entry_id`,
  );
  return rows.length;
}

/** C78.3: one page of a source's stored records, for the re-key (entry id order). */
export async function listWatchlistEntryData(
  db: Db,
  input: { sourceId: string; afterEntryId?: string | undefined; limit: number },
): Promise<{ entryId: string; data: Readonly<Record<string, unknown>> }[]> {
  const rows = await rowsOf(
    db,
    sql`select entry_id as "entryId", data from watchlist_entries
         where source_id = ${input.sourceId}
           ${input.afterEntryId === undefined ? sql`` : sql`and entry_id collate "C" > ${input.afterEntryId}`}
         order by entry_id collate "C" limit ${input.limit}`,
  );
  return rows.map((row) => ({
    entryId: String(row.entryId),
    data: (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<
      string,
      unknown
    >,
  }));
}

/** C78.3: replaces the derived rows of these entries (the re-key). */
export async function replaceWatchlistEntryParts(
  db: Db,
  input: { sourceId: string; entries: readonly WatchlistEntryParts[] },
): Promise<void> {
  await replaceParts(db, input.sourceId, input.entries);
}

/** C74.4: one page of the live entries a sync added or changed (entry id order). */
export async function listChangedWatchlistEntries(
  db: Db,
  input: { sourceId: string; syncId: number; afterEntryId?: string | undefined; limit: number },
): Promise<WatchlistEntryRecord[]> {
  const rows = await rowsOf(
    db,
    sql`select ${ENTRY_COLUMNS} from watchlist_entries e
         where e.source_id = ${input.sourceId} and e.changed_sync_id = ${input.syncId}
           and e.removed_at is null
           ${input.afterEntryId === undefined ? sql`` : sql`and e.entry_id collate "C" > ${input.afterEntryId}`}
         order by e.entry_id collate "C" limit ${input.limit}`,
  );
  return rows.map(entryRecord);
}

/** The sources page: each source's live entries and names. */
export async function countWatchlistSourceContents(
  db: Db,
): Promise<Map<string, { entries: number; names: number }>> {
  const rows = await rowsOf(
    db,
    sql`select e.source_id as "sourceId", count(distinct e.entry_id)::int as entries,
               count(n.entry_id)::int as names
          from watchlist_entries e
          left join watchlist_names n on n.source_id = e.source_id and n.entry_id = e.entry_id
         where e.removed_at is null
         group by e.source_id`,
  );
  return new Map(
    rows.map((row) => [
      String(row.sourceId),
      { entries: Number(row.entries), names: Number(row.names) },
    ]),
  );
}

// Locks (C76.2, P07) ----------------------------------------------------------------------------

/** C76.2 (P07): the advisory lock key of a source, as two int4 keys (namespace, hash). */
export const WATCHLIST_ADVISORY_NAMESPACE = 0x4f565753;

/** C76.2 step 1: a session-level try-lock of the source; false when another session holds it. */
export async function tryLockWatchlistSourceSession(db: Db, sourceId: string): Promise<boolean> {
  const [row] = await rowsOf<{ locked: boolean }>(
    db,
    sql`select pg_try_advisory_lock(${WATCHLIST_ADVISORY_NAMESPACE}::int4, hashtext(${sourceId})) as locked`,
  );
  return row?.locked === true;
}

/** Releases the session-level lock of {@link tryLockWatchlistSourceSession}. */
export async function unlockWatchlistSourceSession(db: Db, sourceId: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_unlock(${WATCHLIST_ADVISORY_NAMESPACE}::int4, hashtext(${sourceId}))`,
  );
}

/** C76.2 step 6: the per-source transaction-level lock, inside the apply transaction. */
export async function lockWatchlistSourceTransaction(db: Db, sourceId: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(${WATCHLIST_ADVISORY_NAMESPACE}::int4, hashtext(${sourceId}))`,
  );
}
