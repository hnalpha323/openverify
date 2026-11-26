/**
 * C74.4, C78.6 (F11, V05): the single-statement reads and writes the re-screen job
 * (`apps/api/src/jobs/reports/rescreen.ts`, owned by `api-watchlists`) makes on the report tables
 * (owned by `api-reports`). `foundation-6` (Workflow 6A Stage 1b) implements and freezes them, so
 * neither owner edits the other's files; a change here is a plan amendment.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { openJson } from '../sealed.js';
import {
  environments,
  reportMatches,
  reports,
  reportTemplateVersions,
  type EnvironmentKind,
} from '../schema.js';
import { SEALED } from '../encrypted-columns.js';
import { chunks } from './watchlist-rows.js';

/** The most subjects one chunk of the reverse index holds (C74.4, P09). */
export const RESCREEN_CHUNK_LIMIT = 50_000;

export interface RescreenScope {
  /** The source whose applied sync is re-screened. */
  sourceId: string;
  /** The report types whose kind of source it is (`watchlist`, `business-watchlist`, ...). */
  reportTypes: readonly string[];
}

/** A recurring, unpaused, unredacted report of the scope's types whose version selects the source. */
function rescreened(scope: RescreenScope): SQL | undefined {
  return and(
    inArray(reports.reportType, [...scope.reportTypes] as (typeof reports.reportType._.data)[]),
    isNotNull(reports.nextRunAt),
    isNull(reports.pausedAt),
    isNull(reports.redactedAt),
    sql`(${reportTemplateVersions.config} -> 'search-lists') ? ${scope.sourceId}`,
  );
}

export interface RescreenEnvironment {
  environmentId: string;
  environmentKind: EnvironmentKind;
}

/**
 * C74.4: the environments that hold a recurring report of one of `reportTypes` whose pinned
 * version selects `sourceId` (its `search-lists`), not paused and not redacted, by id.
 */
export async function listRescreenEnvironments(
  db: Db,
  scope: RescreenScope,
): Promise<RescreenEnvironment[]> {
  if (scope.reportTypes.length === 0) {
    return [];
  }
  return db
    .selectDistinct({ environmentId: environments.id, environmentKind: environments.kind })
    .from(reports)
    .innerJoin(environments, eq(environments.id, reports.environmentId))
    .innerJoin(
      reportTemplateVersions,
      and(
        eq(reportTemplateVersions.environmentId, reports.environmentId),
        eq(reportTemplateVersions.id, reports.reportTemplateVersionId),
      ),
    )
    .where(rescreened(scope))
    .orderBy(asc(environments.id));
}

export interface RecurringReportSubject {
  reportId: string;
  reportType: string;
  /** The decrypted query (C70.2): the subject the reverse index keys (C78.6). */
  query: Record<string, unknown>;
  /**
   * Owner decision 3 after 6B: the configuration of the version the report pins, as stored, so the
   * re-screen screens each report at its own preset.
   */
  config: Record<string, unknown>;
  /**
   * Owner decision 4 after 6C: the id of the version the report pins, so the re-screen resolves each
   * pinned configuration once, however many subjects pin it.
   */
  templateVersionId: string;
}

export interface RecurringReportSubjectsPage extends RescreenScope {
  /** The last report id of the previous chunk. */
  afterId?: string | undefined;
  /** At most {@link RESCREEN_CHUNK_LIMIT}. */
  limit: number;
}

/**
 * C74.4, C78.6: one chunk of the environment's recurring reports that the re-screen screens (as
 * {@link listRescreenEnvironments} selects them), by id, with each query decrypted. Nothing about
 * the subjects is persisted by the caller (decision 23).
 */
export async function listRecurringReportSubjects(
  db: Db,
  environmentId: string,
  page: RecurringReportSubjectsPage,
): Promise<RecurringReportSubject[]> {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > RESCREEN_CHUNK_LIMIT) {
    throw new RangeError(`A chunk holds 1 to ${String(RESCREEN_CHUNK_LIMIT)} subjects`);
  }
  if (page.reportTypes.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      id: reports.id,
      reportType: reports.reportType,
      query: reports.querySealed,
      config: reportTemplateVersions.config,
      templateVersionId: reports.reportTemplateVersionId,
    })
    .from(reports)
    .innerJoin(
      reportTemplateVersions,
      and(
        eq(reportTemplateVersions.environmentId, reports.environmentId),
        eq(reportTemplateVersions.id, reports.reportTemplateVersionId),
      ),
    )
    .where(
      and(
        eq(reports.environmentId, environmentId),
        rescreened(page),
        isNotNull(reports.querySealed),
        page.afterId === undefined ? undefined : gt(reports.id, page.afterId),
      ),
    )
    .orderBy(asc(reports.id))
    .limit(page.limit);
  return rows.flatMap((row) =>
    row.query === null
      ? []
      : [
          {
            reportId: row.id,
            reportType: row.reportType,
            query: openJson(SEALED.reportQuery, row.id, row.query) as Record<string, unknown>,
            config: row.config,
            templateVersionId: row.templateVersionId,
          },
        ],
  );
}

export interface ListUpdateRuns {
  /** The `watchlist_syncs` row the runs screen. */
  syncId: number;
  /** The reports with a candidate above their threshold. */
  reportIds: readonly string[];
  /** The runs' `scheduled_for`. */
  at: Date;
}

/**
 * C74.4 (V05): inserts one `list_update` run, `pending`, for each of `reportIds` that is in the
 * environment and not redacted; a report that already has a run for this sync gets none (the
 * unique `(report_id, trigger_sync_id)`), so a job that runs twice inserts each run once. Returns
 * how many runs it inserted. Review finding C001: the ids go 500 to a statement, because one bound
 * parameter each would pass the protocol's 65,535 for a large environment.
 */
export async function insertListUpdateRuns(
  db: Db,
  environmentId: string,
  input: ListUpdateRuns,
): Promise<number> {
  const at = input.at.toISOString();
  let inserted = 0;
  for (const batch of chunks(input.reportIds)) {
    const ids = sql`array[${sql.join(
      batch.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    const result = (await db.execute(sql`
      insert into report_runs (id, environment_id, report_id, run_type, status, scheduled_for,
        trigger_sync_id)
      select openverify_new_id('rpr', ${at}::timestamptz), ${environmentId}, r.id, 'list_update',
             'pending', ${at}::timestamptz, ${input.syncId}
        from reports r
       where r.environment_id = ${environmentId}
         and r.id = any(${ids})
         and r.redacted_at is null
       order by r.id
      on conflict (report_id, trigger_sync_id) where trigger_sync_id is not null do nothing
      returning id`)) as { rows: unknown[] };
    inserted += result.rows.length;
  }
  return inserted;
}

export interface LiveMatchReportsQuery extends RescreenScope {
  /**
   * The `entry_index` of each changed entry in this environment (`reportMatchEntryIndex`); without
   * them, every live match on the source counts.
   */
  entryIndexes?: readonly string[] | undefined;
}

/**
 * Owner decision 3 after 6B: the re-screened reports of the environment (as
 * {@link listRescreenEnvironments} selects them) with an `open` or `delisted` match on the source
 * whose `entry_index` is one of `entryIndexes` (every live match on the source without them), by
 * id, so their next run re-scores a match whose evidence changed (C75.8). Review finding C001: the
 * indexes go 500 to a statement, because a sync may change more entries than the protocol's 65,535
 * bound parameters.
 */
export async function listReportsWithLiveMatches(
  db: Db,
  environmentId: string,
  query: LiveMatchReportsQuery,
): Promise<string[]> {
  if (query.reportTypes.length === 0 || query.entryIndexes?.length === 0) {
    return [];
  }
  if (query.entryIndexes === undefined) {
    return liveMatchReports(db, environmentId, query, undefined);
  }
  const found = new Set<string>();
  for (const batch of chunks(query.entryIndexes)) {
    for (const id of await liveMatchReports(db, environmentId, query, batch)) {
      found.add(id);
    }
  }
  return [...found].sort();
}

/** One statement of {@link listReportsWithLiveMatches}: every live match, or those of `entryIndexes`. */
async function liveMatchReports(
  db: Db,
  environmentId: string,
  scope: RescreenScope,
  entryIndexes: readonly string[] | undefined,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: reports.id })
    .from(reports)
    .innerJoin(
      reportTemplateVersions,
      and(
        eq(reportTemplateVersions.environmentId, reports.environmentId),
        eq(reportTemplateVersions.id, reports.reportTemplateVersionId),
      ),
    )
    .innerJoin(
      reportMatches,
      and(
        eq(reportMatches.environmentId, reports.environmentId),
        eq(reportMatches.reportId, reports.id),
      ),
    )
    .where(
      and(
        eq(reports.environmentId, environmentId),
        rescreened(scope),
        eq(reportMatches.sourceId, scope.sourceId),
        inArray(reportMatches.status, ['open', 'delisted']),
        entryIndexes === undefined
          ? undefined
          : inArray(reportMatches.entryIndex, [...entryIndexes]),
      ),
    )
    .orderBy(asc(reports.id));
  return rows.map((row) => row.id);
}
