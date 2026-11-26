/**
 * C140.1 (Workflow 8B): case actions and the templates each is offered on, and what the workflow side
 * of cases reads of a case: the case as a run sees it (C120.6: unmasked, masked at every exit), what
 * it holds, and whether it holds a decision's subject (C128.2). Owner `api-case-workflows`;
 * `foundation-8b` froze `listCaseActionsForTemplate`.
 *
 * A prefill names a path, never a value, so an action holds configuration only (P38). Every read and
 * write is scoped to the environment, and the composite keys refuse another environment's template.
 */
import type { CaseActionStatus } from '@openverify/core';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson } from '../sealed.js';
import { reports } from '../tables/reports.js';
import {
  caseAccounts,
  caseActions,
  caseActionTemplates,
  caseGraphQueries,
  caseInquiries,
  caseReportRuns,
  caseReports,
  caseTemplates,
  caseTransactions,
  caseVerifications,
  cases,
  type CaseActionRow,
  type CaseActionVisibility,
  type CaseRow,
} from '../tables/cases.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { firstOrNull, inserted } from './rows.js';

/** An action with the templates it is offered on, in id order. */
export interface CaseAction extends CaseActionRow {
  caseTemplateIds: string[];
}

export interface NewCaseAction {
  id: string;
  workflowId: string;
  label: string;
  placement?: string | undefined;
  /** C172.5: `null` (the default) restricts nothing. */
  visibleWhen?: CaseActionVisibility | null | undefined;
  prefill: Readonly<Record<string, string>>;
  caseTemplateIds: readonly string[];
}

export interface CaseActionChanges {
  label?: string | undefined;
  status?: CaseActionStatus | undefined;
  prefill?: Readonly<Record<string, string>> | undefined;
  /** C172.5 (Workflow 9B). */
  placement?: string | undefined;
  /** C172.5: `null` removes the restriction. */
  visibleWhen?: CaseActionVisibility | null | undefined;
  /** Replaces the whole list. */
  caseTemplateIds?: readonly string[] | undefined;
}

export interface CaseActionFilters {
  workflowIds?: readonly string[] | undefined;
  caseTemplateIds?: readonly string[] | undefined;
  statuses?: readonly CaseActionStatus[] | undefined;
}

/** C172.5: a stored copy of a restriction; `null` restricts nothing. */
const visibilityOf = (visibility: CaseActionVisibility | null): CaseActionVisibility | null =>
  visibility === null
    ? null
    : { statuses: [...visibility.statuses], 'role-ids': [...visibility['role-ids']] };

const scoped = (environmentId: string, id: string) =>
  and(eq(caseActions.environmentId, environmentId), eq(caseActions.id, id));

/** Each action's templates, by action id, in template id order. */
async function templatesOf(
  db: Db,
  environmentId: string,
  actionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>(actionIds.map((id) => [id, []]));
  if (actionIds.length === 0) {
    return found;
  }
  const rows = await db
    .select({
      action: caseActionTemplates.caseActionId,
      template: caseActionTemplates.caseTemplateId,
    })
    .from(caseActionTemplates)
    .where(
      and(
        eq(caseActionTemplates.environmentId, environmentId),
        inArray(caseActionTemplates.caseActionId, [...actionIds]),
      ),
    )
    .orderBy(asc(caseActionTemplates.caseTemplateId));
  for (const { action, template } of rows) {
    found.get(action)?.push(template);
  }
  return found;
}

async function withTemplates(
  db: Db,
  environmentId: string,
  rows: readonly CaseActionRow[],
): Promise<CaseAction[]> {
  const templates = await templatesOf(
    db,
    environmentId,
    rows.map(({ id }) => id),
  );
  return rows.map((row) => ({ ...row, caseTemplateIds: templates.get(row.id) ?? [] }));
}

async function writeTemplates(
  tx: Db,
  environmentId: string,
  caseActionId: string,
  caseTemplateIds: readonly string[],
): Promise<void> {
  await tx
    .delete(caseActionTemplates)
    .where(
      and(
        eq(caseActionTemplates.environmentId, environmentId),
        eq(caseActionTemplates.caseActionId, caseActionId),
      ),
    );
  if (caseTemplateIds.length > 0) {
    await tx
      .insert(caseActionTemplates)
      .values(
        caseTemplateIds.map((caseTemplateId) => ({ environmentId, caseActionId, caseTemplateId })),
      );
  }
}

export async function createCaseAction(
  tx: Db,
  environmentId: string,
  input: NewCaseAction,
): Promise<CaseAction> {
  const rows = await tx
    .insert(caseActions)
    .values({
      id: input.id,
      environmentId,
      workflowId: input.workflowId,
      label: input.label,
      ...(input.placement === undefined ? {} : { placement: input.placement }),
      ...(input.visibleWhen === undefined ? {} : { visibleWhen: visibilityOf(input.visibleWhen) }),
      prefill: { ...input.prefill },
    })
    .returning();
  const row = inserted(rows, 'createCaseAction');
  await writeTemplates(tx, environmentId, row.id, input.caseTemplateIds);
  const [action] = await withTemplates(tx, environmentId, [row]);
  return action ?? { ...row, caseTemplateIds: [] };
}

export async function getCaseAction(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseAction | null> {
  const row = firstOrNull(
    await db.select().from(caseActions).where(scoped(environmentId, id)).limit(1),
  );
  return row === null ? null : ((await withTemplates(db, environmentId, [row]))[0] ?? null);
}

/** `created_at DESC, id DESC` (C1). */
export async function listCaseActions(
  db: Db,
  environmentId: string,
  filters: CaseActionFilters,
  page: PageRequest,
): Promise<Page<CaseAction>> {
  const { workflowIds, caseTemplateIds, statuses } = filters;
  const where = and(
    eq(caseActions.environmentId, environmentId),
    workflowIds === undefined ? undefined : inArray(caseActions.workflowId, [...workflowIds]),
    statuses === undefined ? undefined : inArray(caseActions.status, [...statuses]),
    caseTemplateIds === undefined
      ? undefined
      : inArray(
          caseActions.id,
          db
            .select({ id: caseActionTemplates.caseActionId })
            .from(caseActionTemplates)
            .where(
              and(
                eq(caseActionTemplates.environmentId, environmentId),
                inArray(caseActionTemplates.caseTemplateId, [...caseTemplateIds]),
              ),
            ),
        ),
  );
  const cursor = environmentCursor(caseActions);
  const found = await paginate(db, cursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(caseActions)
      .where(and(where, after))
      .orderBy(...newestFirst(cursor))
      .limit(limit),
  );
  return { items: await withTemplates(db, environmentId, found.items), next: found.next };
}

export async function updateCaseAction(
  tx: Db,
  environmentId: string,
  id: string,
  changes: CaseActionChanges,
): Promise<CaseAction | null> {
  const row = firstOrNull(
    await tx
      .update(caseActions)
      .set({
        ...(changes.label === undefined ? {} : { label: changes.label }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.prefill === undefined ? {} : { prefill: { ...changes.prefill } }),
        ...(changes.placement === undefined ? {} : { placement: changes.placement }),
        ...(changes.visibleWhen === undefined
          ? {}
          : { visibleWhen: visibilityOf(changes.visibleWhen) }),
      })
      .where(scoped(environmentId, id))
      .returning(),
  );
  if (row === null) {
    return null;
  }
  if (changes.caseTemplateIds !== undefined) {
    await writeTemplates(tx, environmentId, id, changes.caseTemplateIds);
  }
  return (await withTemplates(tx, environmentId, [row]))[0] ?? null;
}

/** The active actions offered on a template, oldest first. */
export async function listCaseActionsForTemplate(
  db: Db,
  environmentId: string,
  caseTemplateId: string,
): Promise<CaseActionRow[]> {
  return db
    .select()
    .from(caseActions)
    .where(
      and(
        eq(caseActions.environmentId, environmentId),
        eq(caseActions.status, 'active'),
        inArray(
          caseActions.id,
          db
            .select({ id: caseActionTemplates.caseActionId })
            .from(caseActionTemplates)
            .where(
              and(
                eq(caseActionTemplates.environmentId, environmentId),
                eq(caseActionTemplates.caseTemplateId, caseTemplateId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(caseActions.createdAt), asc(caseActions.id));
}

/** The ids among `ids` that name no case template of this environment, in id order. */
export async function missingCaseTemplates(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const held = await db
    .select({ id: caseTemplates.id })
    .from(caseTemplates)
    .where(
      and(eq(caseTemplates.environmentId, environmentId), inArray(caseTemplates.id, [...ids])),
    );
  const found = new Set(held.map(({ id }) => id));
  return [...new Set(ids)].filter((id) => !found.has(id)).sort();
}

/** What a case holds of one kind: its newest {@link WORKFLOW_CASE_HELD_SERVED}, and the total. */
export interface WorkflowCaseHeldKind<Item> {
  items: Item[];
  count: number;
}

/** C129.2: each held kind's newest, newest first, as the case resource names them. */
export interface WorkflowCaseHeld {
  accounts: WorkflowCaseHeldKind<string>;
  inquiries: WorkflowCaseHeldKind<string>;
  reports: WorkflowCaseHeldKind<{ id: string; reportType: string }>;
  reportRuns: WorkflowCaseHeldKind<string>;
  transactions: WorkflowCaseHeldKind<string>;
  verifications: WorkflowCaseHeldKind<{ id: string; verificationType: string }>;
  graphQueries: WorkflowCaseHeldKind<string>;
}

/**
 * The columns of a case a run reads, named one by one, so a column a later checkpoint adds is read
 * only once this file names it.
 */
const WORKFLOW_CASE_COLUMNS = {
  id: cases.id,
  environmentId: cases.environmentId,
  caseTemplateId: cases.caseTemplateId,
  caseTemplateVersionId: cases.caseTemplateVersionId,
  name: cases.name,
  status: cases.status,
  statusCategory: cases.statusCategory,
  resolution: cases.resolution,
  caseQueueId: cases.caseQueueId,
  creatorType: cases.creatorType,
  creatorId: cases.creatorId,
  assigneeId: cases.assigneeId,
  assignerType: cases.assignerType,
  assignerId: cases.assignerId,
  assignedAt: cases.assignedAt,
  resolverType: cases.resolverType,
  resolverId: cases.resolverId,
  resolvedAt: cases.resolvedAt,
  updaterType: cases.updaterType,
  updaterId: cases.updaterId,
  tags: cases.tags,
  fieldsSealed: cases.fieldsSealed,
  lockVersion: cases.lockVersion,
  redactedAt: cases.redactedAt,
  createdAt: cases.createdAt,
  updatedAt: cases.updatedAt,
} as const;

/** What a run reads of a case's row. */
export type WorkflowCaseRow = Pick<CaseRow, keyof typeof WORKFLOW_CASE_COLUMNS>;

/** The case as a run reads it: its row, its fields opened, what it holds, its newest comments. */
export interface WorkflowCase {
  row: WorkflowCaseRow;
  /** Opened; `null` once redacted. */
  fields: Readonly<Record<string, unknown>> | null;
  held: WorkflowCaseHeld;
  /** The newest comment ids, newest first. */
  commentIds: string[];
}

/** C129.2 (Stage 1a amendment 20): a held kind names its newest 50. */
export const WORKFLOW_CASE_HELD_SERVED = 50;

/** The columns a held-object join table shares. */
interface HeldTable {
  table: PgTable;
  environmentId: AnyPgColumn;
  caseId: AnyPgColumn;
  createdAt: AnyPgColumn;
}

interface HeldObjects extends HeldTable {
  object: AnyPgColumn;
}

const heldOf = (
  table: PgTable & { environmentId: AnyPgColumn; caseId: AnyPgColumn; createdAt: AnyPgColumn },
  object: AnyPgColumn,
): HeldObjects => ({
  table,
  environmentId: table.environmentId,
  caseId: table.caseId,
  createdAt: table.createdAt,
  object,
});

const INQUIRIES = heldOf(caseInquiries, caseInquiries.inquiryId);
const ACCOUNTS = heldOf(caseAccounts, caseAccounts.accountId);
const REPORT_RUNS = heldOf(caseReportRuns, caseReportRuns.reportRunId);
const REPORTS = heldOf(caseReports, caseReports.reportId);
const VERIFICATIONS = heldOf(caseVerifications, caseVerifications.verificationId);
const TRANSACTIONS = heldOf(caseTransactions, caseTransactions.transactionId);
const GRAPH_QUERIES = heldOf(caseGraphQueries, caseGraphQueries.graphQueryId);

/** Every kind a case holds (C136.1). */
const HELD_TABLES: readonly HeldObjects[] = [
  INQUIRIES,
  ACCOUNTS,
  REPORTS,
  REPORT_RUNS,
  TRANSACTIONS,
  VERIFICATIONS,
  GRAPH_QUERIES,
];

const ofCase = (held: HeldTable, environmentId: string, caseId: string): SQL | undefined =>
  and(eq(held.environmentId, environmentId), eq(held.caseId, caseId));

/** The case, or `null` when this environment holds no such case. */
export async function getWorkflowCase(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowCase | null> {
  return (await getWorkflowCases(db, environmentId, [id])).get(id) ?? null;
}

/** A held kind's join table, its object column, and what a joined row adds (a report's type). */
interface HeldKindSql {
  table: string;
  object: string;
  join?: { table: string; column: string; as: string };
}

const HELD_KIND_SQL = {
  inquiries: { table: 'case_inquiries', object: 'inquiry_id' },
  accounts: { table: 'case_accounts', object: 'account_id' },
  reports: {
    table: 'case_reports',
    object: 'report_id',
    join: { table: 'reports', column: 'report_type', as: 'reportType' },
  },
  reportRuns: { table: 'case_report_runs', object: 'report_run_id' },
  transactions: { table: 'case_transactions', object: 'transaction_id' },
  verifications: {
    table: 'case_verifications',
    object: 'verification_id',
    join: { table: 'verifications', column: 'type', as: 'verificationType' },
  },
  graphQueries: { table: 'case_graph_queries', object: 'graph_query_id' },
} as const satisfies Record<keyof WorkflowCaseHeld, HeldKindSql>;

const rowsOf = <Row>(result: unknown): Row[] => (result as { rows: Row[] }).rows;

/**
 * Each case's newest {@link WORKFLOW_CASE_HELD_SERVED} of one kind, newest first, and its total, in
 * two queries for every case of `caseIds` (K8-30). A joined kind names only the objects its join
 * finds, and counts every row, as one case's read did.
 */
async function heldOfCases(
  db: Db,
  kind: HeldKindSql,
  environmentId: string,
  caseIds: readonly string[],
): Promise<Map<string, WorkflowCaseHeldKind<Record<string, string>>>> {
  const ids = sql.join(
    caseIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const extra =
    kind.join === undefined ? sql`` : sql`, j.${sql.identifier(kind.join.column)}::text as extra`;
  const join =
    kind.join === undefined
      ? sql``
      : sql`join ${sql.identifier(kind.join.table)} j
          on j.environment_id = h.environment_id and j.id = h.${sql.identifier(kind.object)}`;
  const ranked = rowsOf<{ case_id: string; object_id: string; extra?: string }>(
    await db.execute(sql`
      select case_id, object_id${kind.join === undefined ? sql`` : sql`, extra`} from (
        select h.case_id, h.${sql.identifier(kind.object)}::text as object_id${extra},
          row_number() over (partition by h.case_id
            order by h.created_at desc, h.${sql.identifier(kind.object)} desc) as rank
        from ${sql.identifier(kind.table)} h ${join}
        where h.environment_id = ${environmentId} and h.case_id in (${ids})
      ) as ranked
      where rank <= ${WORKFLOW_CASE_HELD_SERVED}
      order by case_id, rank`),
  );
  const totals = rowsOf<{ case_id: string; total: number }>(
    await db.execute(sql`
      select case_id, count(*)::int as total from ${sql.identifier(kind.table)}
      where environment_id = ${environmentId} and case_id in (${ids})
      group by case_id`),
  );
  const byCase = new Map<string, WorkflowCaseHeldKind<Record<string, string>>>(
    caseIds.map((id) => [id, { items: [], count: 0 }]),
  );
  for (const row of ranked) {
    byCase
      .get(row.case_id)
      ?.items.push(
        kind.join === undefined
          ? { id: row.object_id }
          : { id: row.object_id, [kind.join.as]: row.extra ?? '' },
      );
  }
  for (const { case_id, total } of totals) {
    const held = byCase.get(case_id);
    if (held !== undefined) {
      held.count = total;
    }
  }
  return byCase;
}

/**
 * K8-30 (Workflow 8D; plan item 115): {@link getWorkflowCase} for every case of `ids` at once, in a
 * fixed number of queries (the rows, the newest comment ids, and two a held kind), whatever their
 * number; a page of cases reads its views through this. Ids this environment does not hold are left
 * out of the map.
 */
export async function getWorkflowCases(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<Map<string, WorkflowCase>> {
  const caseIds = [...new Set(ids)];
  if (caseIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select(WORKFLOW_CASE_COLUMNS)
    .from(cases)
    .where(and(eq(cases.environmentId, environmentId), inArray(cases.id, caseIds)));
  if (rows.length === 0) {
    return new Map();
  }
  const found = rows.map(({ id }) => id);
  const list = sql.join(
    found.map((id) => sql`${id}`),
    sql`, `,
  );
  const comments = rowsOf<{ case_id: string; id: string }>(
    await db.execute(sql`
      select case_id, id from (
        select case_id, id,
          row_number() over (partition by case_id order by created_at desc, id desc) as rank
        from case_comments where environment_id = ${environmentId} and case_id in (${list})
      ) as ranked
      where rank <= ${WORKFLOW_CASE_HELD_SERVED}
      order by case_id, rank`),
  );
  const held = Object.fromEntries(
    await Promise.all(
      (Object.keys(HELD_KIND_SQL) as (keyof WorkflowCaseHeld)[]).map(
        async (kind) =>
          [kind, await heldOfCases(db, HELD_KIND_SQL[kind], environmentId, found)] as const,
      ),
    ),
  ) as Record<keyof WorkflowCaseHeld, Map<string, WorkflowCaseHeldKind<Record<string, string>>>>;
  const plain = (kind: keyof WorkflowCaseHeld, caseId: string): WorkflowCaseHeldKind<string> => {
    const of = held[kind].get(caseId) ?? { items: [], count: 0 };
    return { items: of.items.map(({ id }) => id ?? ''), count: of.count };
  };
  const views = new Map<string, WorkflowCase>();
  for (const row of rows) {
    const reportsHeld = held.reports.get(row.id) ?? { items: [], count: 0 };
    const verificationsHeld = held.verifications.get(row.id) ?? { items: [], count: 0 };
    views.set(row.id, {
      row,
      fields:
        row.fieldsSealed === null
          ? null
          : (openJson(SEALED.caseFields, row.id, row.fieldsSealed) as Record<string, unknown>),
      held: {
        inquiries: plain('inquiries', row.id),
        accounts: plain('accounts', row.id),
        reports: {
          items: reportsHeld.items.map(({ id, reportType }) => ({
            id: id ?? '',
            reportType: reportType ?? '',
          })),
          count: reportsHeld.count,
        },
        reportRuns: plain('reportRuns', row.id),
        transactions: plain('transactions', row.id),
        verifications: {
          items: verificationsHeld.items.map(({ id, verificationType }) => ({
            id: id ?? '',
            verificationType: verificationType ?? '',
          })),
          count: verificationsHeld.count,
        },
        graphQueries: plain('graphQueries', row.id),
      },
      commentIds: comments.filter(({ case_id }) => case_id === row.id).map(({ id }) => id),
    });
  }
  return views;
}

/** C128.2: whether the case holds any of `objectIds`, whatever their kind. */
export async function caseHoldsAnyOf(
  db: Db,
  environmentId: string,
  caseId: string,
  objectIds: readonly string[],
): Promise<boolean> {
  if (objectIds.length === 0) {
    return false;
  }
  for (const held of HELD_TABLES) {
    const [row] = await db
      .select({ id: held.object })
      .from(held.table)
      .where(and(ofCase(held, environmentId, caseId), inArray(held.object, [...objectIds])))
      .limit(1);
    if (row !== undefined) {
      return true;
    }
  }
  return false;
}

/** C128.2: whether the case holds a report of the inquiry (the review recipe's shape). */
export async function caseHoldsReportOfInquiry(
  db: Db,
  environmentId: string,
  caseId: string,
  inquiryId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: caseReports.reportId })
    .from(caseReports)
    .innerJoin(
      reports,
      and(
        eq(reports.environmentId, caseReports.environmentId),
        eq(reports.id, caseReports.reportId),
      ),
    )
    .where(
      and(
        eq(caseReports.environmentId, environmentId),
        eq(caseReports.caseId, caseId),
        eq(reports.inquiryId, inquiryId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function firstHeld(
  db: Db,
  held: HeldObjects,
  environmentId: string,
  caseId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: held.object })
    .from(held.table)
    .where(ofCase(held, environmentId, caseId))
    .orderBy(asc(held.createdAt), asc(held.object))
    .limit(1);
  return row === undefined ? null : String(row.id);
}

/** C140.1: the case's first held inquiry and account, by when they were attached. */
export async function firstHeldInquiryAndAccount(
  db: Db,
  environmentId: string,
  caseId: string,
): Promise<{ inquiryId: string | null; accountId: string | null }> {
  return {
    inquiryId: await firstHeld(db, INQUIRIES, environmentId, caseId),
    accountId: await firstHeld(db, ACCOUNTS, environmentId, caseId),
  };
}
