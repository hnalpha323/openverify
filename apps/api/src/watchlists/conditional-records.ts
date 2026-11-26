/**
 * C254.2 (Phase 11, Workflow 11B, ingestion-11b; decision 39): the watchlist source rows' check
 * columns (migration 0036: `last_validated_at`, `validated_by`, `last_full_check_at`, `last_etag`,
 * `last_modified`), the install's `watchlist-full-check-hours`, and what the sources page serves
 * from them. Read and written by the validator step (`conditional.ts`, under the source's session
 * lock) and read by the sources route (`routes/dashboard/watchlist-sources.ts`).
 *
 * What the page serves (`watchlistSourceStatusSchema`'s optional members):
 * - a source that opts out downloads its file and compares the SHA-256 at every check, so its last
 *   successful check (`last_checked_at`) is both its last validation (`sha256`) and its last full
 *   verification;
 * - a conditional source serves its recorded validation (`http-304`, the publisher's statement, or
 *   `sha256`, the platform's comparison) and its last full verification, unless the sync applied a
 *   new file since: an apply is a full download and comparison too, recorded on the row by the sync
 *   (`last_applied_at`), and the validator step records nothing for it (it runs before the
 *   download), so the later of the two is served.
 * Nothing here holds a list value or a request's URL.
 */
import type { Db } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { installFullCheckHours, type ListValidators } from './conditional-policy.js';
import type { WatchlistManifestSource } from './manifest.js';

/** How a source's file was last validated (`WATCHLIST_VALIDATED_BY`). */
export type WatchlistValidatedBy = 'http-304' | 'sha256';

/** A source row's check columns. */
export interface SourceCheckRecord {
  lastSha256: string | null;
  lastValidatedAt: Date | null;
  validatedBy: WatchlistValidatedBy | null;
  lastFullCheckAt: Date | null;
  validators: ListValidators;
}

/** The source row's own check times the page also reads. */
export interface SourceCheckTimes {
  lastCheckedAt: Date | null;
  lastAppliedAt: Date | null;
}

/** The members the sources document serves (`watchlistSourceStatusSchema`). */
export interface ServedSourceValidation {
  conditional: boolean;
  'last-validated-at': string | null;
  'validated-by': WatchlistValidatedBy | null;
  'last-full-check-at': string | null;
}

const SETTING = 'watchlist-full-check-hours';

const dateOf = (value: unknown): Date | null =>
  value instanceof Date
    ? value
    : typeof value === 'string' || typeof value === 'number'
      ? new Date(value)
      : null;

const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (result as { rows: Record<string, unknown>[] }).rows;

function recordOf(row: Record<string, unknown>): SourceCheckRecord {
  const by = textOf(row.validated_by);
  return {
    lastSha256: textOf(row.last_sha256),
    lastValidatedAt: dateOf(row.last_validated_at),
    validatedBy: by === 'http-304' || by === 'sha256' ? by : null,
    lastFullCheckAt: dateOf(row.last_full_check_at),
    validators: { etag: textOf(row.last_etag), lastModified: textOf(row.last_modified) },
  };
}

const CHECK_COLUMNS = sql`id, last_sha256, last_validated_at, validated_by, last_full_check_at,
  last_etag, last_modified`;

/** Every source row's check columns, by source id. */
export async function listSourceCheckRecords(db: Db): Promise<Map<string, SourceCheckRecord>> {
  const rows = rowsOf(await db.execute(sql`select ${CHECK_COLUMNS} from watchlist_sources`));
  return new Map(rows.map((row) => [String(row.id), recordOf(row)]));
}

/** One source row's check columns, or `null` without a row. */
export async function sourceCheckRecord(
  db: Db,
  sourceId: string,
): Promise<SourceCheckRecord | null> {
  const [row] = rowsOf(
    await db.execute(sql`select ${CHECK_COLUMNS} from watchlist_sources where id = ${sourceId}`),
  );
  return row === undefined ? null : recordOf(row);
}

/**
 * The install's window: the shortest `watchlist-full-check-hours` an environment set, else 24
 * (ours: watchlist sources are install-wide rows, so no environment's own window is outlived).
 */
export async function installWatchlistFullCheckHours(db: Db): Promise<number> {
  const rows = rowsOf(
    await db.execute(
      sql`select (settings ->> ${SETTING})::numeric as hours from environments
           where jsonb_typeof(settings -> ${SETTING}) = 'number'`,
    ),
  );
  return installFullCheckHours(rows.map((row) => (row.hours == null ? null : Number(row.hours))));
}

/**
 * Records a validation at `at`: a 304 (`full` null: `http-304`, the full verification and the
 * validators kept), or a full verification whose file was the applied one, with the validators its
 * answer carried (`sha256`).
 */
export async function recordSourceValidation(
  db: Db,
  sourceId: string,
  at: Date,
  full: ListValidators | null,
): Promise<void> {
  const time = at.toISOString();
  await db.execute(
    full === null
      ? sql`update watchlist_sources
               set last_validated_at = ${time}, validated_by = 'http-304'
             where id = ${sourceId}`
      : sql`update watchlist_sources
               set last_validated_at = ${time}, validated_by = 'sha256',
                   last_full_check_at = ${time},
                   last_etag = ${full.etag}, last_modified = ${full.lastModified}
             where id = ${sourceId}`,
  );
}

const later = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null || a.getTime() >= b.getTime() ? a : b;

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

/** What the sources page serves for one source (see the module). */
export function servedSourceValidation(
  source: WatchlistManifestSource,
  times: SourceCheckTimes | undefined,
  record: SourceCheckRecord | undefined,
): ServedSourceValidation {
  const conditional = source.conditional === true;
  if (!conditional) {
    const checked = times?.lastCheckedAt ?? null;
    return {
      conditional,
      'last-validated-at': iso(checked),
      'validated-by': checked === null ? null : 'sha256',
      'last-full-check-at': iso(checked),
    };
  }
  const applied = times?.lastAppliedAt ?? null;
  const validatedAt = record?.lastValidatedAt ?? null;
  const appliedLater =
    applied !== null && (validatedAt === null || applied.getTime() > validatedAt.getTime());
  return {
    conditional,
    'last-validated-at': iso(appliedLater ? applied : validatedAt),
    'validated-by': appliedLater ? 'sha256' : (record?.validatedBy ?? null),
    'last-full-check-at': iso(later(record?.lastFullCheckAt ?? null, applied)),
  };
}
