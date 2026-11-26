/**
 * C127.12 (Workflow 8A): the outbox of the `list-rescreen` job. Owner: `api-actions`.
 * `stageListUpdated` writes a row with `list.updated`, and the job turns it into one `list_update`
 * run per monitored custom-list report that selects the list.
 */
import { and, asc, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson } from '../sealed.js';
import {
  listRescreenRequests,
  reportTemplateVersions,
  reports,
  type ListRescreenRequestRow,
} from '../schema.js';
import { chunks } from './watchlist-rows.js';

export type ListRescreenRequest = ListRescreenRequestRow;

export interface ListRescreenRequestKey {
  listId: string;
  listVersion: number;
}

/** How long a row the sweep enqueued stays out of its reads: a lost job comes back after this. */
export const LIST_RESCREEN_REENQUEUE_MS = 60_000;

const keyOf = (environmentId: string, key: ListRescreenRequestKey) =>
  and(
    eq(listRescreenRequests.environmentId, environmentId),
    eq(listRescreenRequests.listId, key.listId),
    eq(listRescreenRequests.listVersion, key.listVersion),
  );

/** Once per list version: a repeat answers `false` and writes nothing. */
export async function createListRescreenRequest(
  tx: Db,
  environmentId: string,
  key: ListRescreenRequestKey,
): Promise<boolean> {
  const rows = await tx
    .insert(listRescreenRequests)
    .values({ environmentId, listId: key.listId, listVersion: key.listVersion })
    .onConflictDoNothing()
    .returning({ listId: listRescreenRequests.listId });
  return rows.length > 0;
}

/** The sweep's rows, oldest first, under `FOR UPDATE SKIP LOCKED`, across environments. */
export function listDueListRescreenRequests(
  tx: Db,
  { now, limit }: { now: Date; limit: number },
): Promise<ListRescreenRequest[]> {
  return tx
    .select()
    .from(listRescreenRequests)
    .where(
      and(
        isNull(listRescreenRequests.processedAt),
        or(
          isNull(listRescreenRequests.enqueuedAt),
          lt(listRescreenRequests.enqueuedAt, new Date(now.getTime() - LIST_RESCREEN_REENQUEUE_MS)),
        ),
      ),
    )
    .orderBy(asc(listRescreenRequests.createdAt))
    .limit(limit)
    .for('update', { skipLocked: true });
}

export async function markListRescreenRequestEnqueued(
  tx: Db,
  environmentId: string,
  key: ListRescreenRequestKey,
  at: Date,
): Promise<void> {
  await tx.update(listRescreenRequests).set({ enqueuedAt: at }).where(keyOf(environmentId, key));
}

export async function finishListRescreenRequest(
  tx: Db,
  environmentId: string,
  key: ListRescreenRequestKey,
  at: Date,
): Promise<void> {
  await tx.update(listRescreenRequests).set({ processedAt: at }).where(keyOf(environmentId, key));
}

/** A page of the monitored custom-list reports the job reads. */
const MONITORED_PAGE = 500;

/**
 * C127.12: the custom-list reports that are monitored (recurring, unpaused, unredacted) and select
 * `listId`, on their pinned template or on their sealed query. The custom-list job reads its lists
 * through its own reads, so this never touches `WatchlistReads` or the watchlist's re-screen.
 */
export async function listMonitoredCustomListReports(
  db: Db,
  environmentId: string,
  listId: string,
): Promise<string[]> {
  const found: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await db
      .select({
        id: reports.id,
        query: reports.querySealed,
        config: reportTemplateVersions.config,
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
          eq(reports.reportType, 'custom-list'),
          isNotNull(reports.nextRunAt),
          isNull(reports.pausedAt),
          isNull(reports.redactedAt),
          after === undefined ? undefined : gt(reports.id, after),
        ),
      )
      .orderBy(asc(reports.id))
      .limit(MONITORED_PAGE);
    for (const { id, query, config } of page) {
      const pinned = (config as { 'list-ids'?: readonly string[] | null })['list-ids'];
      const asked =
        pinned ??
        (query === null
          ? undefined
          : (openJson(SEALED.reportQuery, id, query) as { 'list-ids'?: readonly string[] })[
              'list-ids'
            ]);
      if (asked?.includes(listId) === true) {
        found.push(id);
      }
    }
    const last = page.at(-1);
    if (page.length < MONITORED_PAGE || last === undefined) {
      return found;
    }
    after = last.id;
  }
}

export interface ListRescreenRuns extends ListRescreenRequestKey {
  reportIds: readonly string[];
  /** The runs' `scheduled_for`. */
  at: Date;
}

/**
 * C127.12: one `list_update` run, `pending`, for each of `reportIds`, keyed by report, list and
 * version, so a job that runs twice inserts each run once. Answers how many it inserted.
 */
export async function insertListRescreenRuns(
  tx: Db,
  environmentId: string,
  input: ListRescreenRuns,
): Promise<number> {
  const at = input.at.toISOString();
  let inserted = 0;
  for (const batch of chunks(input.reportIds)) {
    const ids = sql`array[${sql.join(
      batch.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    const result = (await tx.execute(sql`
      insert into report_runs (id, environment_id, report_id, run_type, status, scheduled_for,
        trigger_list_id, trigger_list_version)
      select openverify_new_id('rpr', ${at}::timestamptz), ${environmentId}, r.id, 'list_update',
             'pending', ${at}::timestamptz, ${input.listId}, ${input.listVersion}
        from reports r
       where r.environment_id = ${environmentId}
         and r.id = any(${ids})
         and r.redacted_at is null
       order by r.id
      on conflict (report_id, trigger_list_id, trigger_list_version)
        where trigger_list_id is not null do nothing
      returning id`)) as { rows: unknown[] };
    inserted += result.rows.length;
  }
  return inserted;
}
