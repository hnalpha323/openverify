/**
 * The install-wide network source and sync rows (plan C92.2, C92.4, C92.5; Workflow 7A).
 *
 * Owner: `api-network` (Stage 3), behind the signatures `foundation-7a` declared in Stage 1b
 * checkpoint (N), with the reads and writes the sync runner needs (C92.2: the session advisory
 * lock, the locked row, the guards' applied sizes read from the sync `last_sync_id` names) and the
 * purge's (C92.3). {@link NetworkRepositoryNotBuiltError} stays exported for callers that named it.
 *
 * The rows hold public publications, never a subject's data (ADR 0006), so nothing here is sealed.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type {
  NETWORK_ORIGIN_VALUES,
  NETWORK_SYNC_ACTOR_VALUES,
  NETWORK_SYNC_OUTCOME_VALUES,
  NETWORK_SYNC_OVERRIDE_VALUES,
} from '../schema.js';
import {
  bigintArray,
  dateOf,
  numberOf,
  rowsOf,
  stringOf,
  textArray,
  type Row,
} from './watchlist-rows.js';

/** A stub of Workflow 7A Stage 1b that its owner had not built yet (none is left). */
export class NetworkRepositoryNotBuiltError extends Error {
  override name = 'NetworkRepositoryNotBuiltError';

  constructor(name: string) {
    super(`${name} is not built yet (api-network, Workflow 7A Stage 3)`);
  }
}

export type NetworkSyncOutcome = (typeof NETWORK_SYNC_OUTCOME_VALUES)[number];
export type NetworkSyncActor = (typeof NETWORK_SYNC_ACTOR_VALUES)[number];
export type NetworkOrigin = (typeof NETWORK_ORIGIN_VALUES)[number];
export type NetworkSyncOverride = (typeof NETWORK_SYNC_OVERRIDE_VALUES)[number];

/** One manifest source as reconciliation writes it (C92.5). */
export interface ReconciledNetworkSource {
  id: string;
  /** The manifest's `enabled_by_default`, less the disabled and plus the enabled variables. */
  enabled: boolean;
  sandboxOnly: boolean;
}

/** A `network_sources` row: what freshness (C92.4) and the snapshot loader (C92.3) read. */
export interface NetworkSourceState {
  id: string;
  enabled: boolean;
  sandboxOnly: boolean;
  lastSyncId: number | null;
  lastPublishedAt: Date | null;
  lastSha256: string | null;
  lastAppliedAt: Date | null;
  lastCheckedAt: Date | null;
  lastOrigin: NetworkOrigin | null;
  lastErrorCode: string | null;
  checkFailures: number;
  lastFailedAt: Date | null;
}

/** A `network_syncs` row to write (C92.2 step 7). */
export interface NetworkSyncInput {
  sourceId: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: NetworkSyncOutcome;
  errorCode: string | null;
  publishedAt: Date | null;
  sha256: string | null;
  snapshotBytes: number | null;
  entryCount: number;
  coveredIpv4: number | null;
  /** A decimal string: up to 2^128. */
  coveredIpv6: string | null;
  actor: NetworkSyncActor;
  origin: NetworkOrigin | null;
  overrides: readonly NetworkSyncOverride[];
}

const SOURCE_COLUMNS = sql`id, enabled, sandbox_only as "sandboxOnly", last_sync_id as "lastSyncId",
  last_published_at as "lastPublishedAt", last_sha256 as "lastSha256",
  last_applied_at as "lastAppliedAt", last_checked_at as "lastCheckedAt",
  last_origin as "lastOrigin", last_error_code as "lastErrorCode",
  check_failures as "checkFailures", last_failed_at as "lastFailedAt"`;

function sourceState(row: Row): NetworkSourceState {
  return {
    id: String(row.id),
    enabled: Boolean(row.enabled),
    sandboxOnly: Boolean(row.sandboxOnly),
    lastSyncId: numberOf(row.lastSyncId),
    lastPublishedAt: dateOf(row.lastPublishedAt),
    lastSha256: stringOf(row.lastSha256),
    lastAppliedAt: dateOf(row.lastAppliedAt),
    lastCheckedAt: dateOf(row.lastCheckedAt),
    lastOrigin: stringOf(row.lastOrigin) as NetworkOrigin | null,
    lastErrorCode: stringOf(row.lastErrorCode),
    checkFailures: numberOf(row.checkFailures) ?? 0,
    lastFailedAt: dateOf(row.lastFailedAt),
  };
}

const timestamp = (value: Date | null) => (value === null ? null : value.toISOString());

/**
 * C92.5: upserts one row per manifest source (`enabled` and `sandbox_only` only) and disables the
 * rows no manifest source names any more, which stay for history. Nothing else writes `enabled`.
 * Returns the sources upserted and the rows turned off.
 */
export async function reconcileNetworkSourceRows(
  db: Db,
  sources: readonly ReconciledNetworkSource[],
): Promise<{ upserted: number; disabled: number }> {
  if (sources.length > 0) {
    await db.execute(sql`
      insert into network_sources (id, enabled, sandbox_only)
      values ${sql.join(
        sources.map((source) => sql`(${source.id}, ${source.enabled}, ${source.sandboxOnly})`),
        sql`, `,
      )}
      on conflict (id) do update
        set enabled = excluded.enabled, sandbox_only = excluded.sandbox_only, updated_at = now()
        where network_sources.enabled is distinct from excluded.enabled
           or network_sources.sandbox_only is distinct from excluded.sandbox_only`);
  }
  const disabled = await rowsOf(
    db,
    sql`update network_sources set enabled = false, updated_at = now()
         where enabled and not (id = any(${textArray(sources.map(({ id }) => id))}))
        returning id`,
  );
  return { upserted: sources.length, disabled: disabled.length };
}

/** Every source row, in id order: what the snapshot loader re-checks every 60 s (C92.3). */
export async function listNetworkSourceStates(db: Db): Promise<NetworkSourceState[]> {
  return (await rowsOf(db, sql`select ${SOURCE_COLUMNS} from network_sources order by id`)).map(
    sourceState,
  );
}

/** C92.2 step 7: writes the audit row of one check, apply or refusal; returns its id. */
export async function insertNetworkSync(db: Db, input: NetworkSyncInput): Promise<number> {
  const rows = await rowsOf<{ id: number | string }>(
    db,
    sql`insert into network_syncs (source_id, started_at, finished_at, outcome, error_code,
          published_at, sha256, snapshot_bytes, entry_count, covered_ipv4, covered_ipv6, actor,
          origin, overrides)
        values (${input.sourceId}, ${timestamp(input.startedAt)}, ${timestamp(input.finishedAt)},
          ${input.outcome}, ${input.errorCode}, ${timestamp(input.publishedAt)}, ${input.sha256},
          ${input.snapshotBytes}, ${input.entryCount}, ${input.coveredIpv4},
          ${input.coveredIpv6}::numeric, ${input.actor}, ${input.origin},
          ${textArray(input.overrides)})
        returning id`,
  );
  return Number(rows[0]?.id);
}

/** C92.2 step 1: the advisory-lock namespace of the network sources ("OVNS"). */
export const NETWORK_ADVISORY_NAMESPACE = 0x4f564e53;

/** A `network_syncs` row, as the guards, the purge and the sources page read it. */
export interface NetworkSync {
  id: number;
  sourceId: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: NetworkSyncOutcome;
  errorCode: string | null;
  publishedAt: Date | null;
  sha256: string | null;
  snapshotBytes: number | null;
  entryCount: number;
  coveredIpv4: number | null;
  coveredIpv6: string | null;
  actor: NetworkSyncActor;
  origin: NetworkOrigin | null;
  overrides: NetworkSyncOverride[];
  supersededAt: Date | null;
  snapshotDeletedAt: Date | null;
}

/** C92.2 step 6: the source after an applied sync (provenance and the check). */
export interface AppliedNetworkSource {
  sourceId: string;
  syncId: number;
  publishedAt: Date | null;
  sha256: string;
  at: Date;
  origin: NetworkOrigin;
}

/** A superseded snapshot object the purge may delete (C92.3, P27). */
export interface PurgeableNetworkSnapshot {
  syncId: number;
  sourceId: string;
  sha256: string;
}

const SYNC_COLUMNS = sql`id, source_id as "sourceId", started_at as "startedAt",
  finished_at as "finishedAt", outcome, error_code as "errorCode", published_at as "publishedAt",
  sha256, snapshot_bytes as "snapshotBytes", entry_count as "entryCount",
  covered_ipv4 as "coveredIpv4", covered_ipv6::text as "coveredIpv6", actor, origin, overrides,
  superseded_at as "supersededAt", snapshot_deleted_at as "snapshotDeletedAt"`;

/** A `text[]` as node-postgres or PGlite return it. */
function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  const text = typeof value === 'string' ? value.replace(/^\{|\}$/g, '') : '';
  return text === '' ? [] : text.split(',');
}

function syncRow(row: Row): NetworkSync {
  return {
    id: Number(row.id),
    sourceId: String(row.sourceId),
    startedAt: dateOf(row.startedAt) ?? new Date(0),
    finishedAt: dateOf(row.finishedAt),
    outcome: String(row.outcome) as NetworkSyncOutcome,
    errorCode: stringOf(row.errorCode),
    publishedAt: dateOf(row.publishedAt),
    sha256: stringOf(row.sha256),
    snapshotBytes: numberOf(row.snapshotBytes),
    entryCount: numberOf(row.entryCount) ?? 0,
    coveredIpv4: numberOf(row.coveredIpv4),
    coveredIpv6: stringOf(row.coveredIpv6),
    actor: String(row.actor) as NetworkSyncActor,
    origin: stringOf(row.origin) as NetworkOrigin | null,
    overrides: textList(row.overrides) as NetworkSyncOverride[],
    supersededAt: dateOf(row.supersededAt),
    snapshotDeletedAt: dateOf(row.snapshotDeletedAt),
  };
}

/** C92.2 step 1: the session-level lock of a source; `false` when another sync holds it. */
export async function tryLockNetworkSourceSession(db: Db, sourceId: string): Promise<boolean> {
  const [row] = await rowsOf<{ locked: boolean }>(
    db,
    sql`select pg_try_advisory_lock(${NETWORK_ADVISORY_NAMESPACE}::int4, hashtext(${sourceId})) as locked`,
  );
  return row?.locked === true;
}

/** Releases {@link tryLockNetworkSourceSession}. */
export async function unlockNetworkSourceSession(db: Db, sourceId: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_unlock(${NETWORK_ADVISORY_NAMESPACE}::int4, hashtext(${sourceId}))`,
  );
}

/** C92.2 step 6: the per-source transaction-level lock, inside the apply transaction. */
export async function lockNetworkSourceTransaction(db: Db, sourceId: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(${NETWORK_ADVISORY_NAMESPACE}::int4, hashtext(${sourceId}))`,
  );
}

/** C92.2 step 6: the source row under `FOR UPDATE`; `null` without a row. */
export async function lockNetworkSourceRow(
  db: Db,
  sourceId: string,
): Promise<NetworkSourceState | null> {
  const [row] = await rowsOf(
    db,
    sql`select ${SOURCE_COLUMNS} from network_sources where id = ${sourceId} for update`,
  );
  return row === undefined ? null : sourceState(row);
}

/** C92.4: a successful check (`applied` or `unchanged`): the check time, the error cleared. */
export async function recordNetworkSourceCheck(
  db: Db,
  input: { sourceId: string; at: Date },
): Promise<void> {
  await db.execute(sql`
    update network_sources
       set last_checked_at = ${input.at.toISOString()}::timestamptz, last_error_code = null,
           check_failures = 0, last_failed_at = null, updated_at = now()
     where id = ${input.sourceId}`);
}

/**
 * A source's last error code; with `failedAt`, the check itself failed and counts toward the
 * refresh back-off (as owner decision 6 after Workflow 6A for watchlists).
 */
export async function recordNetworkSourceError(
  db: Db,
  input: { sourceId: string; code: string; failedAt?: Date | undefined },
): Promise<void> {
  const failure =
    input.failedAt === undefined
      ? sql``
      : sql`, check_failures = check_failures + 1,
             last_failed_at = ${input.failedAt.toISOString()}::timestamptz`;
  await db.execute(sql`
    update network_sources set last_error_code = ${input.code}${failure}, updated_at = now()
     where id = ${input.sourceId}`);
}

/** C92.2 step 7: the source after an applied sync. */
export async function recordNetworkSourceApplied(
  db: Db,
  input: AppliedNetworkSource,
): Promise<void> {
  const at = input.at.toISOString();
  await db.execute(sql`
    update network_sources
       set last_sync_id = ${input.syncId}, last_published_at = ${timestamp(input.publishedAt)}::timestamptz,
           last_sha256 = ${input.sha256}, last_applied_at = ${at}::timestamptz,
           last_checked_at = ${at}::timestamptz, last_origin = ${input.origin},
           last_error_code = null, check_failures = 0, last_failed_at = null, updated_at = now()
     where id = ${input.sourceId}`);
}

/** One sync row, or `null`. */
export async function getNetworkSync(db: Db, id: number): Promise<NetworkSync | null> {
  const [row] = await rowsOf(db, sql`select ${SYNC_COLUMNS} from network_syncs where id = ${id}`);
  return row === undefined ? null : syncRow(row);
}

/** The newest sync rows, newest first (`started_at desc, id desc`), for the sources page. */
export async function listRecentNetworkSyncs(db: Db, limit: number): Promise<NetworkSync[]> {
  return (
    await rowsOf(
      db,
      sql`select ${SYNC_COLUMNS} from network_syncs order by started_at desc, id desc limit ${limit}`,
    )
  ).map(syncRow);
}

/** C92.3: marks every earlier applied sync of the source superseded at `at`; returns the count. */
export async function supersedeNetworkSyncs(
  db: Db,
  input: { sourceId: string; keepSyncId: number; at: Date },
): Promise<number> {
  const rows = await rowsOf(
    db,
    sql`update network_syncs set superseded_at = ${input.at.toISOString()}::timestamptz
         where source_id = ${input.sourceId} and outcome = 'applied' and superseded_at is null
           and id <> ${input.keepSyncId}
        returning id`,
  );
  return rows.length;
}

/**
 * C92.3 (P27): the snapshot objects superseded before `supersededBefore` and still stored, other
 * than each source's current and previous one (and never one whose SHA-256 either of them uses,
 * since the object key is the digest), oldest first.
 */
export async function listPurgeableNetworkSnapshots(
  db: Db,
  input: { supersededBefore: Date; limit: number },
): Promise<PurgeableNetworkSnapshot[]> {
  const rows = await rowsOf(
    db,
    sql`with kept as (
          select source_id, sha256 from network_syncs
           where outcome = 'applied' and superseded_at is null and sha256 is not null
          union
          (select distinct on (source_id) source_id, sha256 from network_syncs
            where outcome = 'applied' and superseded_at is not null and sha256 is not null
            order by source_id, superseded_at desc, id desc)
        )
        select s.id as "syncId", s.source_id as "sourceId", s.sha256 from network_syncs s
         where s.outcome = 'applied' and s.snapshot_deleted_at is null and s.sha256 is not null
           and s.superseded_at < ${input.supersededBefore.toISOString()}::timestamptz
           and not exists (select 1 from kept k where k.source_id = s.source_id and k.sha256 = s.sha256)
         order by s.superseded_at, s.id
         limit ${input.limit}`,
  );
  return rows.map((row) => ({
    syncId: Number(row.syncId),
    sourceId: String(row.sourceId),
    sha256: String(row.sha256),
  }));
}

/** C92.3: records that the purge deleted these syncs' snapshot objects. */
export async function markNetworkSnapshotsDeleted(
  db: Db,
  input: { syncIds: readonly number[]; at: Date },
): Promise<void> {
  if (input.syncIds.length === 0) {
    return;
  }
  await db.execute(sql`
    update network_syncs set snapshot_deleted_at = ${input.at.toISOString()}::timestamptz
     where id = any(${bigintArray(input.syncIds)})`);
}
