/**
 * C129.2, C131 (Workflow 8B): case rows. Owner `api-cases`; `foundation-8b` froze the names. Every
 * read and write is scoped to the environment, and `fields` is sealed for its row
 * (`SEALED.caseFields`).
 *
 * Template visibility (C129.4, P14) is a condition of these queries, so a page or a count holds only
 * what its reader may see: {@link caseVisibleTo} names a template a reader sees, and
 * {@link hiddenCaseObjectIds} the case and comment ids a reader may not.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { CaseSlaOnReopen, CaseSlaState } from '@openverify/core';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptionalJson, sealJson } from '../sealed.js';
import {
  caseAccounts,
  caseComments,
  caseInquiries,
  caseReports,
  cases,
  caseTemplates,
  type CaseRow,
} from '../tables/cases.js';
import { accounts } from '../tables/accounts.js';
import { apiKeys, environments } from '../tables/tenancy.js';
import { userRoles } from '../tables/users.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { roleAssignmentReaches } from './roles.js';
import { allFilters, createdAtRange, equalsAny, firstOrNull, inserted } from './rows.js';

/** A case with its fields opened: each key to `{ type, value }`, `null` once redacted. */
export interface Case extends Omit<CaseRow, 'fieldsSealed'> {
  fields: Readonly<Record<string, unknown>> | null;
}

/** What `createCaseRow` writes; the service has taken the name from `nextCaseNumber`. */
export interface NewCaseRow {
  id: string;
  caseTemplateId: string;
  caseTemplateVersionId: string;
  name: string;
  status: string;
  statusCategory: CaseRow['statusCategory'];
  caseQueueId: string | null;
  creatorType: CaseRow['creatorType'];
  creatorId: string;
  tags: readonly string[];
  /** Opened values; sealed by the repository. */
  fields: Readonly<Record<string, unknown>>;
  workflowRunStepId?: string | null;
}

/** C133.4: the SLA columns, written together, as `case-logic`'s transitions answer them. */
export interface CaseSlaColumns {
  state: CaseSlaState;
  epoch: number;
  consumedMs: number;
  segmentStartedAt: Date | null;
  expiresAt: Date | null;
  expiredAt: Date | null;
  metAt: Date | null;
  targetMs: number | null;
  policyId: string | null;
  policyRevision: number | null;
  calendarId: string | null;
  onReopen: CaseSlaOnReopen;
}

/** What a change sets; every change bumps `lock_version` (C131.2). */
export interface CaseChanges {
  status?: string;
  statusCategory?: CaseRow['statusCategory'];
  resolution?: string | null;
  caseQueueId?: string | null;
  assigneeId?: string | null;
  assignerType?: CaseRow['assignerType'];
  assignerId?: string | null;
  assignedAt?: Date | null;
  resolverType?: CaseRow['resolverType'];
  resolverId?: string | null;
  resolvedAt?: Date | null;
  updaterType?: CaseRow['updaterType'];
  updaterId?: string | null;
  tags?: readonly string[];
  /** Opened values; sealed by the repository. `null` only with `redactedAt`. */
  fields?: Readonly<Record<string, unknown>> | null;
  redactedAt?: Date;
  sla?: CaseSlaColumns;
}

/** The case of a row, its fields opened. */
export function toCase(row: CaseRow): Case {
  const { fieldsSealed, ...rest } = row;
  return {
    ...rest,
    fields: openOptionalJson(SEALED.caseFields, row.id, fieldsSealed) as Readonly<
      Record<string, unknown>
    > | null,
  };
}

/** The SLA columns of a case, as `case-logic` reads them. */
export function caseSlaOf(row: Case | CaseRow): CaseSlaColumns {
  return {
    state: row.slaState,
    epoch: row.slaEpoch,
    consumedMs: row.slaConsumedMs,
    segmentStartedAt: row.slaSegmentStartedAt,
    expiresAt: row.slaExpiresAt,
    expiredAt: row.slaExpiredAt,
    metAt: row.slaMetAt,
    targetMs: row.slaTargetMs,
    policyId: row.slaPolicyId,
    policyRevision: row.slaPolicyRevision,
    calendarId: row.slaCaseCalendarId,
    onReopen: row.slaOnReopen,
  };
}

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(cases.environmentId, environmentId), eq(cases.id, id));

export async function createCaseRow(
  tx: Db,
  environmentId: string,
  input: NewCaseRow,
): Promise<Case> {
  return toCase(
    inserted(
      await tx
        .insert(cases)
        .values({
          id: input.id,
          environmentId,
          caseTemplateId: input.caseTemplateId,
          caseTemplateVersionId: input.caseTemplateVersionId,
          name: input.name,
          status: input.status,
          statusCategory: input.statusCategory,
          caseQueueId: input.caseQueueId,
          creatorType: input.creatorType,
          creatorId: input.creatorId,
          tags: [...input.tags],
          fieldsSealed: sealJson(SEALED.caseFields, input.id, input.fields),
          workflowRunStepId: input.workflowRunStepId ?? null,
        })
        .returning(),
      'createCaseRow',
    ),
  );
}

/** The case, or `null` when this environment holds no such case. */
export async function getCaseRow(db: Db, environmentId: string, id: string): Promise<Case | null> {
  const row = firstOrNull(
    await db.select().from(cases).where(inEnvironment(environmentId, id)).limit(1),
  );
  return row === null ? null : toCase(row);
}

/** C131.2: the case row `FOR UPDATE`, or `null`. */
export async function lockCaseRow(tx: Db, environmentId: string, id: string): Promise<Case | null> {
  const row = firstOrNull(
    await tx.select().from(cases).where(inEnvironment(environmentId, id)).for('update'),
  );
  return row === null ? null : toCase(row);
}

/** C129.2: the template's next number, under its counter row's lock (an upsert takes it). */
export async function nextCaseNumber(
  tx: Db,
  environmentId: string,
  caseTemplateId: string,
): Promise<number> {
  const result = await tx.execute(sql`
    insert into case_name_counters (environment_id, case_template_id, last_value)
    values (${environmentId}, ${caseTemplateId}, 1)
    on conflict (environment_id, case_template_id)
    do update set last_value = case_name_counters.last_value + 1
    returning last_value`);
  const [row] = (result as { rows: { last_value: string | number }[] }).rows;
  if (row === undefined) {
    throw new Error('nextCaseNumber: the database returned no row');
  }
  return Number(row.last_value);
}

/**
 * C118.4 (the recurring trigger): an environment's unredacted cases, oldest first, after `cursor`.
 * `listWorkflowObjectsAfter` calls it for `case`. The cursor is a case id, and ids are ordered by
 * their ULID, so the oldest come first.
 */
export async function listCasesAfter(
  db: Db,
  environmentId: string,
  options: { cursor: string | null; limit: number },
): Promise<string[]> {
  const rows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.environmentId, environmentId),
        isNull(cases.redactedAt),
        options.cursor === null ? undefined : gt(cases.id, options.cursor),
      ),
    )
    .orderBy(asc(cases.id))
    .limit(options.limit);
  return rows.map(({ id }) => id);
}

const slaSet = (sla: CaseSlaColumns) => ({
  slaState: sla.state,
  slaEpoch: sla.epoch,
  slaConsumedMs: sla.consumedMs,
  slaSegmentStartedAt: sla.segmentStartedAt,
  slaExpiresAt: sla.expiresAt,
  slaExpiredAt: sla.expiredAt,
  slaMetAt: sla.metAt,
  slaTargetMs: sla.targetMs,
  slaPolicyId: sla.policyId,
  slaPolicyRevision: sla.policyRevision,
  slaCaseCalendarId: sla.calendarId,
  slaOnReopen: sla.onReopen,
});

/** One change under the caller's lock; `lock_version` moves by one. `null` when no case matched. */
export async function updateCaseRow(
  tx: Db,
  environmentId: string,
  id: string,
  changes: CaseChanges,
): Promise<Case | null> {
  const { fields, tags, sla, ...plain } = changes;
  const row = firstOrNull(
    await tx
      .update(cases)
      .set({
        ...plain,
        ...(tags === undefined ? {} : { tags: [...tags] }),
        ...(fields === undefined
          ? {}
          : { fieldsSealed: fields === null ? null : sealJson(SEALED.caseFields, id, fields) }),
        ...(sla === undefined ? {} : slaSet(sla)),
        lockVersion: sql`${cases.lockVersion} + 1`,
      })
      .where(inEnvironment(environmentId, id))
      .returning(),
  );
  return row === null ? null : toCase(row);
}

/** Who reads cases (C129.4): a user through their roles, a key through its list, or the system. */
export type CaseReader =
  { kind: 'user'; userId: string } | { kind: 'api-key'; apiKeyId: string } | { kind: 'system' };

/**
 * C129.4 (P14): the template in `templateId` is one `reader` may see: it lists no role, or the user
 * holds a listed role, or the key's `case-template-ids` names it. The system sees every template.
 */
export function templateVisibleTo(
  reader: CaseReader,
  environmentId: AnyPgColumn | string,
  templateId: AnyPgColumn,
): SQL {
  if (reader.kind === 'system') {
    return sql`true`;
  }
  const allowed =
    reader.kind === 'user'
      ? sql`t.visible_to_roles && array(
          select ur.role_id from ${userRoles} ur where ur.user_id = ${reader.userId}
            and ${roleAssignmentReaches(sql`ur`, sql`${environmentId}`)})`
      : sql`t.id = any(coalesce(
          (select k.case_template_ids from ${apiKeys} k where k.id = ${reader.apiKeyId}),
          '{}'::text[]))`;
  return sql`exists (select 1 from ${caseTemplates} t
    where t.environment_id = ${environmentId} and t.id = ${templateId}
      and (cardinality(t.visible_to_roles) = 0 or ${allowed}))`;
}

/** {@link templateVisibleTo} for the `cases` table. */
export const caseVisibleTo = (reader: CaseReader): SQL =>
  templateVisibleTo(reader, cases.environmentId, cases.caseTemplateId);

/**
 * Of `ids` (case and comment ids, C129.4), those that name a case of this environment whose template
 * `reader` may not see. An id that names nothing is not hidden: there is nothing to keep from anyone.
 */
export async function hiddenCaseObjectIds(
  db: Db,
  environmentId: string,
  reader: CaseReader,
  ids: readonly string[],
): Promise<Set<string>> {
  const caseIds = ids.filter((id) => id.startsWith('case_'));
  const commentIds = ids.filter((id) => id.startsWith('cscm_'));
  const hidden = new Set<string>();
  if (reader.kind === 'system') {
    return hidden;
  }
  if (caseIds.length > 0) {
    const rows = await db
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(
          eq(cases.environmentId, environmentId),
          inArray(cases.id, [...new Set(caseIds)]),
          sql`not ${caseVisibleTo(reader)}`,
        ),
      );
    rows.forEach(({ id }) => hidden.add(id));
  }
  if (commentIds.length > 0) {
    const rows = await db
      .select({ id: caseComments.id })
      .from(caseComments)
      .innerJoin(
        cases,
        and(eq(cases.environmentId, caseComments.environmentId), eq(cases.id, caseComments.caseId)),
      )
      .where(
        and(
          eq(caseComments.environmentId, environmentId),
          inArray(caseComments.id, [...new Set(commentIds)]),
          sql`not ${caseVisibleTo(reader)}`,
        ),
      );
    rows.forEach(({ id }) => hidden.add(id));
  }
  return hidden;
}

/** C129.5, C137.1: `GET /cases`'s filters; each list is "any of". */
export interface CaseFilters {
  statuses?: readonly string[] | undefined;
  caseTemplateIds?: readonly string[] | undefined;
  accountIds?: readonly string[] | undefined;
  /** The held account's reference id. */
  referenceId?: string | undefined;
  inquiryIds?: readonly string[] | undefined;
  reportIds?: readonly string[] | undefined;
  caseQueueIds?: readonly string[] | undefined;
  assigneeIds?: readonly string[] | undefined;
  statusCategories?: readonly string[] | undefined;
  slaStates?: readonly string[] | undefined;
  createdAtStart?: Date | undefined;
  createdAtEnd?: Date | undefined;
}

const holding = (
  table: typeof caseAccounts | typeof caseInquiries | typeof caseReports,
  column: AnyPgColumn,
  ids: readonly string[] | undefined,
): SQL | undefined | null => {
  if (ids === undefined) {
    return undefined;
  }
  if (ids.length === 0) {
    return null;
  }
  return sql`exists (select 1 from ${table}
    where ${table.environmentId} = ${cases.environmentId} and ${table.caseId} = ${cases.id}
      and ${inArray(column, [...ids])})`;
};

/** The conditions of {@link CaseFilters}, or `null` when one is an empty list (nothing matches). */
export function caseFilterConditions(filters: CaseFilters): (SQL | undefined)[] | null {
  return allFilters([
    equalsAny(cases.status, filters.statuses),
    equalsAny(cases.caseTemplateId, filters.caseTemplateIds),
    holding(caseAccounts, caseAccounts.accountId, filters.accountIds),
    filters.referenceId === undefined
      ? undefined
      : sql`exists (select 1 from ${caseAccounts}
          inner join ${accounts} on ${accounts.environmentId} = ${caseAccounts.environmentId}
            and ${accounts.id} = ${caseAccounts.accountId}
          where ${caseAccounts.environmentId} = ${cases.environmentId}
            and ${caseAccounts.caseId} = ${cases.id}
            and ${accounts.referenceId} = ${filters.referenceId})`,
    holding(caseInquiries, caseInquiries.inquiryId, filters.inquiryIds),
    holding(caseReports, caseReports.reportId, filters.reportIds),
    equalsAny(cases.caseQueueId, filters.caseQueueIds),
    equalsAny(cases.assigneeId, filters.assigneeIds),
    equalsAny(cases.statusCategory, filters.statusCategories),
    equalsAny(cases.slaState, filters.slaStates),
    ...createdAtRange(cases.createdAt, filters),
  ]);
}

const caseCursor = environmentCursor(cases);

/** C137.1: newest first (C1), with the filters and the reader's visibility. */
export async function listCaseRows(
  db: Db,
  environmentId: string,
  reader: CaseReader,
  filters: CaseFilters,
  page: PageRequest,
): Promise<Page<Case>> {
  const conditions = caseFilterConditions(filters);
  if (conditions === null) {
    return { items: [], next: null };
  }
  const result = await paginate(db, caseCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(cases)
      .where(
        and(eq(cases.environmentId, environmentId), caseVisibleTo(reader), ...conditions, after),
      )
      .orderBy(...newestFirst(caseCursor))
      .limit(limit),
  );
  return { items: result.items.map(toCase), next: result.next };
}

/** The visible cases of `ids`, in the order given; an id this reader may not see is left out. */
export async function getCaseRows(
  db: Db,
  environmentId: string,
  reader: CaseReader,
  ids: readonly string[],
): Promise<Case[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.environmentId, environmentId),
        inArray(cases.id, [...ids]),
        caseVisibleTo(reader),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, toCase(row)]));
  return ids.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [found];
  });
}

/**
 * C139.3: resolved, unredacted cases past their environment's `case-retention-days` (none by default,
 * so an environment that sets none is never reached), oldest resolution first.
 */
export async function listCasesPastRetention(
  db: Db,
  now: Date,
  limit: number,
): Promise<{ id: string; environmentId: string }[]> {
  return db
    .select({ id: cases.id, environmentId: cases.environmentId })
    .from(cases)
    .innerJoin(environments, eq(environments.id, cases.environmentId))
    .where(
      and(
        isNull(cases.redactedAt),
        isNotNull(cases.resolvedAt),
        sql`(${environments.settings} ->> 'case-retention-days') is not null`,
        sql`${cases.resolvedAt} <= ${now.toISOString()}::timestamptz
          - make_interval(days => (${environments.settings} ->> 'case-retention-days')::integer)`,
      ),
    )
    .orderBy(asc(cases.resolvedAt), asc(cases.id))
    .limit(limit);
}
