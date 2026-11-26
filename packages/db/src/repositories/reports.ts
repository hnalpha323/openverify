/**
 * C70, C72, C73: reports: creation under the C73.7 lock order, reads, lists and filters, tags,
 * monitoring state, run completion's report columns, redaction (C73.5) and the index rebuild.
 *
 * Owner: `api-reports` (Workflow 6A Stage 3), who adds every function this file needs and replaces
 * the {@link rebuildReportIndexes} stub. The file and its export line in `repositories/index.ts`
 * are frozen by `foundation-6` (Stage 1b), as is `rebuildReportIndexes`' signature, which
 * `apps/api/scripts/blind-index-rebuild.ts` calls.
 */
import type { ReportType } from '@openverify/core';
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import {
  assertBlindIndexKey,
  reportCryptoAddressIndex,
  reportMatchEntryIndex,
  reportMatchEvidenceHash,
} from '../blind-index.js';
import type { Db } from '../client.js';
import {
  accounts,
  reportAccounts,
  reportActions,
  reportMatches,
  reportRuns,
  reports,
  reportTemplateVersions,
  type ReportRow,
} from '../schema.js';
import { openOptionalJson, sealJson, sealOptionalJson } from '../sealed.js';
import { forgetStoredResponses, stubEventPayloads } from './redaction.js';
import type { RebuildIndexesOptions, RebuildIndexesResult } from './government-id-extractions.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, hasAnyTag, inserted, type OneOrMany } from './rows.js';
import { applyTagOperation, type TagOperation } from './tags.js';

/** The owner of this repository file. */
export const REPORTS_REPOSITORY_OWNER = 'api-reports';

export type ReportStatusValue = ReportRow['status'];
export type ReportOriginValue = ReportRow['origin'];

/** A report as the service reads it: its row with the sealed values opened and its links. */
export interface StoredReport {
  id: string;
  environmentId: string;
  reportType: ReportType;
  reportTemplateId: string;
  reportTemplateVersionId: string;
  /** The pinned version's number (`v<N>`). */
  versionNumber: number;
  origin: ReportOriginValue;
  status: ReportStatusValue;
  /** The query, opened; `null` once redacted. */
  query: Record<string, unknown> | null;
  queryFields: string[];
  querySources: Record<string, string>;
  /** The sealed result, opened; `null` before a run or once redacted. */
  result: Record<string, unknown> | null;
  coverage: { complete: boolean; limits: string[] } | null;
  hasMatch: boolean;
  errors: { code: string; source?: string }[];
  unavailableFields: { field: string; reason: string }[];
  sources: Record<string, unknown>[];
  matcherVersion: string | null;
  provider: { id: string; sandbox: boolean } | null;
  thresholds: Record<string, string | number | boolean> | null;
  notices: string[];
  inquiryId: string | null;
  accountId: string | null;
  /** Every linked account (`report_accounts`), the home one included, oldest link first. */
  accountIds: string[];
  recurrenceIntervalDays: number | null;
  nextRunAt: Date | null;
  pausedAt: Date | null;
  pausedReason: 'operator' | 'match' | null;
  tags: string[];
  cryptoAddressIndex: string | null;
  /** Runs that completed (`ready` or `errored`): `is-continuous` is more than one. */
  completedRunCount: number;
  createdAt: Date;
  completedAt: Date | null;
  redactedAt: Date | null;
}

export interface NewReportInput {
  id: string;
  reportType: ReportType;
  reportTemplateId: string;
  reportTemplateVersionId: string;
  origin: ReportOriginValue;
  query: Record<string, unknown>;
  querySources: Record<string, string>;
  inquiryId: string | null;
  /** The home account; also linked in `report_accounts`. */
  accountId: string | null;
  recurrenceIntervalDays: number | null;
  nextRunAt: Date | null;
  createdAt: Date;
  /** The `initial` run, inserted with the report. */
  initialRun: { id: string; scheduledFor: Date };
}

export interface ListReportsOptions extends PageRequest {
  reportTemplateId?: OneOrMany<string> | undefined;
  status?: OneOrMany<ReportStatusValue> | undefined;
  /** C69.4: `false` lists only `ready` reports without an open match. */
  hasMatch?: boolean | undefined;
  /** The home account or any linked one. */
  accountId?: OneOrMany<string> | undefined;
  inquiryId?: OneOrMany<string> | undefined;
  /** The reference id of a linked account. */
  referenceId?: string | undefined;
  tag?: OneOrMany<string> | undefined;
  reportType?: OneOrMany<ReportType> | undefined;
}

/** The columns a run's completion, a monitoring action or a redaction writes (C74). */
export interface ReportStateChanges {
  status?: ReportStatusValue;
  result?: Record<string, unknown> | null;
  coverage?: { complete: boolean; limits: readonly string[] } | null;
  hasMatch?: boolean;
  errors?: readonly { code: string; source?: string }[];
  unavailableFields?: readonly { field: string; reason: string }[];
  sources?: readonly Record<string, unknown>[];
  matcherVersion?: string | null;
  provider?: { id: string; sandbox: boolean } | null;
  thresholds?: Readonly<Record<string, string | number | boolean>> | null;
  notices?: readonly string[];
  accountId?: string | null;
  recurrenceIntervalDays?: number | null;
  nextRunAt?: Date | null;
  pausedAt?: Date | null;
  pausedReason?: 'operator' | 'match' | null;
  cryptoAddressIndex?: string | null;
  completedAt?: Date | null;
}

/** What redacting a report's rows changed; counts only. */
export interface RedactedReportRows {
  matches: number;
  actions: number;
}

const SEALED_QUERY = 'reports.query';
const SEALED_RESULT = 'reports.result';

const reportCursor = environmentCursor(reports);
const reportIn = (environmentId: string, id: string) =>
  and(eq(reports.environmentId, environmentId), eq(reports.id, id));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The row, opened, with its version number, links and completed run count. */
function toStoredReport(
  row: ReportRow,
  extra: { versionNumber: number; accountIds: string[]; completedRunCount: number },
): StoredReport {
  return {
    id: row.id,
    environmentId: row.environmentId,
    reportType: row.reportType,
    reportTemplateId: row.reportTemplateId,
    reportTemplateVersionId: row.reportTemplateVersionId,
    versionNumber: extra.versionNumber,
    origin: row.origin,
    status: row.status,
    query: asRecord(openOptionalJson(SEALED_QUERY, row.id, row.querySealed)),
    queryFields: row.queryFields,
    querySources: row.querySources,
    result: asRecord(openOptionalJson(SEALED_RESULT, row.id, row.resultSealed)),
    coverage: row.coverage ?? null,
    hasMatch: row.hasMatch,
    errors: row.errors,
    unavailableFields: row.unavailableFields,
    sources: row.sources,
    matcherVersion: row.matcherVersion,
    provider: row.provider ?? null,
    thresholds: row.thresholds ?? null,
    notices: row.notices,
    inquiryId: row.inquiryId,
    accountId: row.accountId,
    accountIds: extra.accountIds,
    recurrenceIntervalDays: row.recurrenceIntervalDays,
    nextRunAt: row.nextRunAt,
    pausedAt: row.pausedAt,
    pausedReason: row.pausedReason ?? null,
    tags: row.tags,
    cryptoAddressIndex: row.cryptoAddressIndex,
    completedRunCount: extra.completedRunCount,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    redactedAt: row.redactedAt,
  };
}

/** Opens rows and adds what each needs from the other report tables (three queries). */
async function stored(
  db: Db,
  environmentId: string,
  rows: readonly ReportRow[],
): Promise<StoredReport[]> {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);
  const versionIds = [...new Set(rows.map((row) => row.reportTemplateVersionId))];
  const versions = await db
    .select({ id: reportTemplateVersions.id, version: reportTemplateVersions.version })
    .from(reportTemplateVersions)
    .where(
      and(
        eq(reportTemplateVersions.environmentId, environmentId),
        inArray(reportTemplateVersions.id, versionIds),
      ),
    );
  const links = await db
    .select({ reportId: reportAccounts.reportId, accountId: reportAccounts.accountId })
    .from(reportAccounts)
    .where(
      and(eq(reportAccounts.environmentId, environmentId), inArray(reportAccounts.reportId, ids)),
    )
    .orderBy(asc(reportAccounts.createdAt), asc(reportAccounts.accountId));
  const completed = await db
    .select({ reportId: reportRuns.reportId, value: count() })
    .from(reportRuns)
    .where(
      and(
        eq(reportRuns.environmentId, environmentId),
        inArray(reportRuns.reportId, ids),
        inArray(reportRuns.status, ['ready', 'errored']),
      ),
    )
    .groupBy(reportRuns.reportId);
  const versionNumbers = new Map(versions.map((version) => [version.id, version.version]));
  const accountIds = new Map<string, string[]>();
  for (const link of links) {
    accountIds.set(link.reportId, [...(accountIds.get(link.reportId) ?? []), link.accountId]);
  }
  const runCounts = new Map(completed.map((row) => [row.reportId, row.value]));
  return rows.map((row) =>
    toStoredReport(row, {
      versionNumber: versionNumbers.get(row.reportTemplateVersionId) ?? 1,
      accountIds: accountIds.get(row.id) ?? [],
      completedRunCount: runCounts.get(row.id) ?? 0,
    }),
  );
}

/**
 * C72.1, C84.2: a report (`pending`) and its `initial` run in the caller's transaction, its home
 * account linked in `report_accounts`. The caller holds the C73.7 locks.
 */
export async function createReport(
  db: Db,
  environmentId: string,
  input: NewReportInput,
): Promise<StoredReport> {
  const row = inserted(
    await db
      .insert(reports)
      .values({
        id: input.id,
        environmentId,
        reportType: input.reportType,
        reportTemplateId: input.reportTemplateId,
        reportTemplateVersionId: input.reportTemplateVersionId,
        origin: input.origin,
        status: 'pending',
        querySealed: sealJson(SEALED_QUERY, input.id, input.query),
        queryFields: Object.keys(input.query),
        querySources: input.querySources,
        inquiryId: input.inquiryId,
        accountId: input.accountId,
        recurrenceIntervalDays: input.recurrenceIntervalDays,
        nextRunAt: input.nextRunAt,
        createdAt: input.createdAt,
      })
      .returning(),
    'createReport',
  );
  await db.insert(reportRuns).values({
    id: input.initialRun.id,
    environmentId,
    reportId: row.id,
    runType: 'initial',
    status: 'pending',
    scheduledFor: input.initialRun.scheduledFor,
    createdAt: input.createdAt,
  });
  if (input.accountId !== null) {
    await linkReportAccount(db, environmentId, row.id, input.accountId);
  }
  const [report] = await stored(db, environmentId, [row]);
  if (report === undefined) {
    throw new Error('createReport: the report was not read back');
  }
  return report;
}

/** The report, opened; `lock` takes its row (C73.7). `null` when it is not in this environment. */
export async function getReport(
  db: Db,
  environmentId: string,
  id: string,
  options: { lock?: 'update' | 'share' | undefined } = {},
): Promise<StoredReport | null> {
  const query = db.select().from(reports).where(reportIn(environmentId, id));
  const rows = options.lock === undefined ? await query : await query.for(options.lock);
  return firstOrNull(await stored(db, environmentId, rows));
}

/** Reports by id, newest first; ids not in the environment are left out. */
export async function getReports(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<StoredReport[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(reports)
    .where(and(eq(reports.environmentId, environmentId), inArray(reports.id, [...ids])))
    .orderBy(...newestFirst(reportCursor));
  return stored(db, environmentId, rows);
}

const list = <T extends string>(value: OneOrMany<T>): T[] =>
  typeof value === 'string' ? [value] : [...value];

/** A report linked to one of the accounts: its home account, or a `report_accounts` link. */
function linkedToAccounts(accountIds: readonly string[]): SQL | null {
  if (accountIds.length === 0) {
    return null;
  }
  return sql`(${reports.accountId} in ${accountIds} or exists (
      select 1 from ${reportAccounts}
       where ${reportAccounts.environmentId} = ${reports.environmentId}
         and ${reportAccounts.reportId} = ${reports.id}
         and ${reportAccounts.accountId} in ${accountIds}))`;
}

/** A report linked to an account whose reference id is `referenceId`. */
function linkedToReference(referenceId: string): SQL {
  return sql`exists (
      select 1 from ${accounts}
       where ${accounts.environmentId} = ${reports.environmentId}
         and ${accounts.referenceId} = ${referenceId}
         and (${accounts.id} = ${reports.accountId} or exists (
           select 1 from ${reportAccounts}
            where ${reportAccounts.environmentId} = ${reports.environmentId}
              and ${reportAccounts.reportId} = ${reports.id}
              and ${reportAccounts.accountId} = ${accounts.id})))`;
}

/** `GET /reports` (C72.1): newest first, with the public filters. */
export async function listReports(
  db: Db,
  environmentId: string,
  options: ListReportsOptions = {},
): Promise<Page<StoredReport>> {
  const filters = allFilters([
    eq(reports.environmentId, environmentId),
    equalsAny(reports.reportTemplateId, options.reportTemplateId),
    equalsAny(reports.status, options.status),
    equalsAny(reports.inquiryId, options.inquiryId),
    equalsAny(reports.reportType, options.reportType),
    options.hasMatch === undefined
      ? undefined
      : options.hasMatch
        ? eq(reports.hasMatch, true)
        : and(eq(reports.status, 'ready'), eq(reports.hasMatch, false)),
    options.accountId === undefined ? undefined : linkedToAccounts(list(options.accountId)),
    options.referenceId === undefined ? undefined : linkedToReference(options.referenceId),
    hasAnyTag(reports.tags, options.tag),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  const page = await paginate(db, reportCursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(reports)
      .where(and(...filters, after))
      .orderBy(...newestFirst(reportCursor))
      .limit(limit),
  );
  return { items: await stored(db, environmentId, page.items), next: page.next };
}

/** C70.5: the ids of the reports of an inquiry, or linked to an account, newest first. */
export async function listLinkedReportIds(
  db: Db,
  environmentId: string,
  target: { inquiryId: string } | { accountId: string },
  options: { limit?: number | undefined } = {},
): Promise<string[]> {
  const where =
    'inquiryId' in target
      ? eq(reports.inquiryId, target.inquiryId)
      : linkedToAccounts([target.accountId]);
  const query = db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.environmentId, environmentId), where ?? undefined))
    .orderBy(...newestFirst(reportCursor));
  const rows = options.limit === undefined ? await query : await query.limit(options.limit);
  return rows.map((row) => row.id);
}

/** C9 tags under the report's row lock; `null` when the report is not here. */
export async function applyReportTagOperation(
  db: Db,
  environmentId: string,
  id: string,
  operation: TagOperation,
): Promise<{ report: StoredReport; changed: boolean } | null> {
  return db.transaction(async (tx) => {
    const current = firstOrNull(
      await tx.select().from(reports).where(reportIn(environmentId, id)).for('update'),
    );
    if (current === null) {
      return null;
    }
    const { tags, changed } = applyTagOperation(current.tags, operation);
    const row = changed
      ? inserted(
          await tx.update(reports).set({ tags }).where(reportIn(environmentId, id)).returning(),
          'applyReportTagOperation',
        )
      : current;
    const [report] = await stored(tx, environmentId, [row]);
    if (report === undefined) {
      throw new Error('applyReportTagOperation: the report was not read back');
    }
    return { report, changed };
  });
}

/** Writes the given columns of the report (the caller holds its lock). */
export async function updateReportState(
  db: Db,
  environmentId: string,
  id: string,
  changes: ReportStateChanges,
): Promise<void> {
  const set: Partial<typeof reports.$inferInsert> = {};
  if (changes.status !== undefined) set.status = changes.status;
  if (changes.result !== undefined) {
    set.resultSealed = sealOptionalJson(SEALED_RESULT, id, changes.result);
  }
  if (changes.coverage !== undefined) {
    set.coverage =
      changes.coverage === null
        ? null
        : { complete: changes.coverage.complete, limits: [...changes.coverage.limits] };
  }
  if (changes.hasMatch !== undefined) set.hasMatch = changes.hasMatch;
  if (changes.errors !== undefined) set.errors = changes.errors.map((error) => ({ ...error }));
  if (changes.unavailableFields !== undefined) {
    set.unavailableFields = changes.unavailableFields.map((entry) => ({ ...entry }));
  }
  if (changes.sources !== undefined) set.sources = changes.sources.map((entry) => ({ ...entry }));
  if (changes.matcherVersion !== undefined) set.matcherVersion = changes.matcherVersion;
  if (changes.provider !== undefined) set.provider = changes.provider;
  if (changes.thresholds !== undefined) {
    set.thresholds = changes.thresholds === null ? null : { ...changes.thresholds };
  }
  if (changes.notices !== undefined) set.notices = [...changes.notices];
  if (changes.accountId !== undefined) set.accountId = changes.accountId;
  if (changes.recurrenceIntervalDays !== undefined) {
    set.recurrenceIntervalDays = changes.recurrenceIntervalDays;
  }
  if (changes.nextRunAt !== undefined) set.nextRunAt = changes.nextRunAt;
  if (changes.pausedAt !== undefined) set.pausedAt = changes.pausedAt;
  if (changes.pausedReason !== undefined) set.pausedReason = changes.pausedReason;
  if (changes.cryptoAddressIndex !== undefined) set.cryptoAddressIndex = changes.cryptoAddressIndex;
  if (changes.completedAt !== undefined) set.completedAt = changes.completedAt;
  if (Object.keys(set).length === 0) {
    return;
  }
  await db.update(reports).set(set).where(reportIn(environmentId, id));
}

/** C84.4: links an account to the report; `false` when it was linked already. */
export async function linkReportAccount(
  db: Db,
  environmentId: string,
  reportId: string,
  accountId: string,
): Promise<boolean> {
  const rows = await db
    .insert(reportAccounts)
    .values({ environmentId, reportId, accountId })
    .onConflictDoNothing()
    .returning({ reportId: reportAccounts.reportId });
  return rows.length > 0;
}

/**
 * C84.4: consolidation moves the absorbed accounts' report links (and home accounts) to the
 * absorbing one, deduplicated. Returns the reports whose links moved.
 */
export async function moveReportAccountLinks(
  db: Db,
  environmentId: string,
  targetId: string,
  sourceIds: readonly string[],
): Promise<number> {
  const sources = sourceIds.filter((id) => id !== targetId);
  if (sources.length === 0) {
    return 0;
  }
  const moved = await db
    .select({ reportId: reportAccounts.reportId })
    .from(reportAccounts)
    .where(
      and(
        eq(reportAccounts.environmentId, environmentId),
        inArray(reportAccounts.accountId, sources),
      ),
    );
  const homes = await db
    .update(reports)
    .set({ accountId: targetId })
    .where(and(eq(reports.environmentId, environmentId), inArray(reports.accountId, sources)))
    .returning({ id: reports.id });
  const reportIds = [...new Set([...moved.map((row) => row.reportId), ...homes.map((r) => r.id)])];
  for (const reportId of reportIds) {
    await linkReportAccount(db, environmentId, reportId, targetId);
  }
  await db
    .delete(reportAccounts)
    .where(
      and(
        eq(reportAccounts.environmentId, environmentId),
        inArray(reportAccounts.accountId, sources),
      ),
    );
  return reportIds.length;
}

/**
 * C73.5: nulls the report's query, result and crypto index, every match's snapshot, entry index
 * and evidence hash and every action's details (the trigger's `openverify.report_redaction`
 * case), sets `redacted_at` and cancels monitoring, in the caller's transaction. `null` when the
 * report is not here or was redacted before.
 */
export async function redactReportRecords(
  db: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<RedactedReportRows | null> {
  // A transaction of its own (a savepoint inside the caller's), so the trigger's
  // transaction-local redaction case holds for the action update and no longer.
  return db.transaction((tx) => redactInTx(tx, environmentId, id, at));
}

async function redactInTx(
  db: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<RedactedReportRows | null> {
  const redacted = await db
    .update(reports)
    .set({
      querySealed: null,
      resultSealed: null,
      cryptoAddressIndex: null,
      nextRunAt: null,
      redactedAt: at,
    })
    .where(and(reportIn(environmentId, id), isNull(reports.redactedAt)))
    .returning({ id: reports.id });
  if (redacted.length === 0) {
    return null;
  }
  const matches = await db
    .update(reportMatches)
    .set({ snapshotSealed: null, entryIndex: null, evidenceHash: null, updatedAt: at })
    .where(and(eq(reportMatches.environmentId, environmentId), eq(reportMatches.reportId, id)))
    .returning({ id: reportMatches.id });
  await db.execute(sql`select set_config('openverify.report_redaction', 'on', true)`);
  const actions = await db
    .update(reportActions)
    .set({ detailsSealed: null })
    .where(
      and(
        eq(reportActions.environmentId, environmentId),
        eq(reportActions.reportId, id),
        isNotNull(reportActions.detailsSealed),
      ),
    )
    .returning({ id: reportActions.id });
  await db.execute(sql`select set_config('openverify.report_redaction', 'off', true)`);
  return { matches: matches.length, actions: actions.length };
}

/**
 * C72.5 (R002): serialises the environment's recurring-cap checks with the inserts they allow,
 * until the caller's transaction ends. Take it before any other lock of the creation, so it never
 * waits while holding one.
 */
export async function lockRecurringReportCaps(db: Db, environmentId: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`openverify/report-recurring-caps/${environmentId}`}, 0))`,
  );
}

/** C72.5: the environment's recurring, unredacted reports, of the given types if any. */
export async function countRecurringReports(
  db: Db,
  environmentId: string,
  options: { reportTypes?: readonly ReportType[] | undefined } = {},
): Promise<number> {
  const types = options.reportTypes;
  const [row] = await db
    .select({ value: count() })
    .from(reports)
    .where(
      and(
        eq(reports.environmentId, environmentId),
        isNotNull(reports.nextRunAt),
        isNull(reports.redactedAt),
        types === undefined ? undefined : inArray(reports.reportType, [...types]),
      ),
    );
  return row?.value ?? 0;
}

/** C72.5 (V09): scheduled media runs per day, the sum of 1 / interval over recurring media reports. */
export async function scheduledMediaRunsPerDay(db: Db, environmentId: string): Promise<number> {
  const [row] = await db
    .select({
      value: sql<number>`coalesce(sum(1.0 / ${reports.recurrenceIntervalDays}), 0)`.mapWith(Number),
    })
    .from(reports)
    .where(
      and(
        eq(reports.environmentId, environmentId),
        isNotNull(reports.nextRunAt),
        isNotNull(reports.recurrenceIntervalDays),
        isNull(reports.redactedAt),
        inArray(reports.reportType, ['adverse-media', 'business-adverse-media']),
      ),
    );
  return row?.value ?? 0;
}

/**
 * C73.5: stubs every earlier event of these reports (the C16 stub) and clears the stored API-log
 * bodies and idempotent answers about them or naming them (`subject_ids`), as an inquiry's
 * redaction does for its own; for a report redacted on its own (`DELETE /reports/:id`, retention).
 * Returns how many events were stubbed.
 */
export async function forgetReportCopies(
  db: Db,
  environmentId: string,
  reportIds: readonly string[],
  at: Date,
): Promise<number> {
  if (reportIds.length === 0) {
    return 0;
  }
  const stubbed = await stubEventPayloads(db, environmentId, reportIds, at);
  await forgetStoredResponses(db, environmentId, reportIds);
  return stubbed;
}

/** C73.5: the unredacted reports linked to the account (home or `report_accounts`), by id. */
export async function listAccountReportIds(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.environmentId, environmentId),
        isNull(reports.redactedAt),
        linkedToAccounts([accountId]) ?? undefined,
      ),
    )
    .orderBy(asc(reports.id));
  return rows.map((row) => row.id);
}

/** C73.5: the unredacted reports of the inquiry, by id. */
export async function listInquiryReportIds(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.environmentId, environmentId),
        eq(reports.inquiryId, inquiryId),
        isNull(reports.redactedAt),
      ),
    )
    .orderBy(asc(reports.id));
  return rows.map((row) => row.id);
}

/** What `blind-index:rebuild` re-indexed of the reports (C73.4). */
export interface ReportIndexesRebuild {
  /** `reports.crypto_address_index`, from the sealed query. */
  reports: RebuildIndexesResult;
  /** `report_matches.entry_index` and `evidence_hash`, from the sealed snapshot and query. */
  matches: RebuildIndexesResult;
}

/**
 * C73.4 `blind-index:rebuild`: recomputes every unredacted report's `crypto_address_index` and
 * every unredacted match's `entry_index` and `evidence_hash` under `key`, from stored values only
 * (the sealed query and the sealed snapshot, which holds the readable entry key and the entry's
 * content hash at match time), never today's list (P10, H18, F13). Redacted rows are skipped.
 *
 * Each table goes in id-ordered batches under row locks; nothing is logged or returned but
 * counts.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes, before anything is read.
 */
export async function rebuildReportIndexes(
  db: Db,
  key: Uint8Array,
  options: RebuildIndexesOptions = {},
): Promise<ReportIndexesRebuild> {
  assertBlindIndexKey(key);
  const batchSize = options.batchSize ?? DEFAULT_REBUILD_BATCH_SIZE;
  return {
    reports: await rebuildCryptoIndexes(db, key, batchSize),
    matches: await rebuildMatchIndexes(db, key, batchSize),
  };
}

const DEFAULT_REBUILD_BATCH_SIZE = 100;

/** `crypto_address_index` from the canonical address the run sealed in `result`. */
async function rebuildCryptoIndexes(
  db: Db,
  key: Uint8Array,
  batchSize: number,
): Promise<RebuildIndexesResult> {
  let after = '';
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: reports.id,
          environmentId: reports.environmentId,
          resultSealed: reports.resultSealed,
          index: reports.cryptoAddressIndex,
        })
        .from(reports)
        .where(
          and(
            isNull(reports.redactedAt),
            isNotNull(reports.cryptoAddressIndex),
            gt(reports.id, after),
          ),
        )
        .orderBy(asc(reports.id))
        .limit(batchSize)
        .for('update');
      let changed = 0;
      for (const row of rows) {
        const result = asRecord(openOptionalJson(SEALED_RESULT, row.id, row.resultSealed));
        const address = result?.['canonical-address'];
        if (typeof address !== 'string') {
          continue;
        }
        const index = reportCryptoAddressIndex(key, { environmentId: row.environmentId, address });
        if (index !== row.index) {
          await tx.update(reports).set({ cryptoAddressIndex: index }).where(eq(reports.id, row.id));
          changed += 1;
        }
      }
      return { count: rows.length, changed, last: rows.at(-1)?.id };
    });
    scanned += batch.count;
    updated += batch.changed;
    if (batch.last === undefined || batch.count < batchSize) {
      return { scanned, updated };
    }
    after = batch.last;
  }
}

/** `entry_index` and `evidence_hash` from the entry key and evidence input sealed in `snapshot`. */
async function rebuildMatchIndexes(
  db: Db,
  key: Uint8Array,
  batchSize: number,
): Promise<RebuildIndexesResult> {
  let after = '';
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: reportMatches.id,
          environmentId: reportMatches.environmentId,
          snapshotSealed: reportMatches.snapshotSealed,
          entryIndex: reportMatches.entryIndex,
          evidenceHash: reportMatches.evidenceHash,
        })
        .from(reportMatches)
        .where(and(isNotNull(reportMatches.snapshotSealed), gt(reportMatches.id, after)))
        .orderBy(asc(reportMatches.id))
        .limit(batchSize)
        .for('update');
      let changed = 0;
      for (const row of rows) {
        const snapshot = asRecord(
          openOptionalJson('report_matches.snapshot', row.id, row.snapshotSealed),
        );
        const entryKey = snapshot?.['entry-key'];
        const evidence = snapshot?.['evidence-input'];
        if (typeof entryKey !== 'string' || typeof evidence !== 'string') {
          continue;
        }
        const environmentId = row.environmentId;
        const entryIndex = reportMatchEntryIndex(key, { environmentId, entryKey });
        const evidenceHash = reportMatchEvidenceHash(key, { environmentId, parts: [evidence] });
        if (entryIndex !== row.entryIndex || evidenceHash !== row.evidenceHash) {
          await tx
            .update(reportMatches)
            .set({ entryIndex, evidenceHash })
            .where(eq(reportMatches.id, row.id));
          changed += 1;
        }
      }
      return { count: rows.length, changed, last: rows.at(-1)?.id };
    });
    scanned += batch.count;
    updated += batch.changed;
    if (batch.last === undefined || batch.count < batchSize) {
      return { scanned, updated };
    }
    after = batch.last;
  }
}

/** The scheduled media runs per day of one environment and of the whole install. */
export interface ScheduledMediaRunLoad {
  readonly environmentRunsPerDay: number;
  readonly installRunsPerDay: number;
}

/**
 * C81.2 (V09), owner decision 18 after 6B (R004): the sources page's media figures, read in one
 * statement: the sum of 1 / interval over every recurring, unpaused, unredacted `adverse-media`
 * and `business-adverse-media` report, within the asking environment and across the install. The
 * page serves the environment's own figure and only compares the install's with the budget, so
 * one tenant never reads another's load.
 */
export async function scheduledMediaRunLoad(
  db: Db,
  environmentId: string,
): Promise<ScheduledMediaRunLoad> {
  const {
    rows: [row],
  } = (await db.execute(
    sql`select coalesce(sum(1.0 / recurrence_interval_days)
                          filter (where environment_id = ${environmentId}), 0)::float8 as environment,
               coalesce(sum(1.0 / recurrence_interval_days), 0)::float8 as install
          from reports
         where report_type in ('adverse-media', 'business-adverse-media')
           and next_run_at is not null and recurrence_interval_days is not null
           and paused_at is null and redacted_at is null`,
  )) as { rows: { environment: number | string; install: number | string }[] };
  return {
    environmentRunsPerDay: Number(row?.environment ?? 0),
    installRunsPerDay: Number(row?.install ?? 0),
  };
}
