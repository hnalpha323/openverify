/**
 * C76, C78.3: the row helpers and column lists that the watchlist reads (`watchlist-reads.ts`), the
 * key frequencies (`watchlist-key-df.ts`) and the sync's writes (`watchlists.ts`) share. Internal:
 * `repositories/index.ts` does not export this file.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { WatchlistEntryRecord, WatchlistSourceState } from './watchlist-reads.js';

export type Row = Record<string, unknown>;

export async function rowsOf<T extends Row = Row>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute<T>(query);
  return (result as { rows: T[] }).rows;
}

/** A `text[]` literal of bound parameters (an empty array without any). */
export function textArray(values: readonly string[]): SQL {
  return values.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`;
}

export function bigintArray(values: readonly number[]): SQL {
  return values.length === 0
    ? sql`'{}'::bigint[]`
    : sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::bigint[]`;
}

export const dateOf = (value: unknown): Date | null =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value
      : new Date(typeof value === 'number' ? value : (value as string));

export const numberOf = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export const stringOf = (value: unknown): string | null =>
  value === null || value === undefined ? null : (value as string);

/** Rows per multi-row statement: well under Postgres's 65,535 bound parameters. */
export const BATCH = 500;

export function chunks<T>(items: readonly T[], size: number = BATCH): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

export const ENTRY_COLUMNS = sql`e.source_id as "sourceId", e.entry_id as "entryId", e.kind,
  e.content_hash as "contentHash", e.risk_data_hash as "riskDataHash", e.data,
  e.removed_at as "removedAt"`;

export function entryRecord(row: Row): WatchlistEntryRecord {
  return {
    sourceId: String(row.sourceId),
    entryId: String(row.entryId),
    kind: String(row.kind) as WatchlistEntryRecord['kind'],
    contentHash: String(row.contentHash),
    riskDataHash: String(row.riskDataHash),
    data: (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<
      string,
      unknown
    >,
    removedAt: dateOf(row.removedAt),
  };
}

export const SOURCE_COLUMNS = sql`id, enabled, sandbox_only as "sandboxOnly", keys_version as "keysVersion",
  last_sync_id as "lastSyncId", last_published_at as "lastPublishedAt", last_sha256 as "lastSha256",
  last_applied_at as "lastAppliedAt", last_checked_at as "lastCheckedAt",
  last_origin as "lastOrigin", last_error_code as "lastErrorCode",
  check_failures as "checkFailures", last_failed_at as "lastFailedAt"`;

export function sourceState(row: Row): WatchlistSourceState {
  return {
    id: String(row.id),
    enabled: Boolean(row.enabled),
    sandboxOnly: Boolean(row.sandboxOnly),
    keysVersion: stringOf(row.keysVersion),
    lastSyncId: numberOf(row.lastSyncId),
    lastPublishedAt: dateOf(row.lastPublishedAt),
    lastSha256: stringOf(row.lastSha256),
    lastAppliedAt: dateOf(row.lastAppliedAt),
    lastCheckedAt: dateOf(row.lastCheckedAt),
    lastOrigin: stringOf(row.lastOrigin) as WatchlistSourceState['lastOrigin'],
    lastErrorCode: stringOf(row.lastErrorCode),
    checkFailures: numberOf(row.checkFailures) ?? 0,
    lastFailedAt: dateOf(row.lastFailedAt),
  };
}
