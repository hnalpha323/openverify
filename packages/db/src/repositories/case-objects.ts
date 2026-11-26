/**
 * C136.1-C136.3 (Workflow 8B): what a case holds, one join table per kind. Owner `api-cases`;
 * `foundation-8b` froze the names.
 *
 * - An object is found by its id's prefix in its own table of this environment, and its state as
 *   attached is plaintext and PII-free by rule: its status, its template or type, when it was made
 *   and, for an inquiry, the ids of the verifications finished then (C136.3).
 * - A verification of type `document` is held as a document (H31), in `case_verifications`.
 * - The composite foreign keys refuse another environment's object; an object attaches once, so a
 *   repeat is no change (C136.2).
 */
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { CaseHeldObjectType } from '@openverify/core';
import type { Db } from '../client.js';
import { InvalidCursorError } from '../errors.js';
import { accounts } from '../tables/accounts.js';
import {
  caseAccounts,
  caseGraphQueries,
  caseInquiries,
  caseReportRuns,
  caseReports,
  cases,
  caseTransactions,
  caseVerifications,
} from '../tables/cases.js';
import { graphQueries } from '../tables/graph.js';
import { inquiries } from '../tables/inquiries.js';
import { reportRuns, reports } from '../tables/reports.js';
import { transactions } from '../tables/transactions.js';
import { verifications } from '../tables/verifications.js';
import { pageSize, type Page } from './pagination.js';

/** One held object, as attached. */
export interface CaseHeldObjectRow {
  caseId: string;
  objectType: CaseHeldObjectType;
  objectId: string;
  attachedByType: 'user' | 'api-key' | 'workflow-run';
  attachedById: string;
  attachedState: Readonly<Record<string, unknown>>;
  attachedAt: Date;
}

/** An object a case can hold, found in this environment, with its state now. */
export interface AttachableObject {
  objectType: CaseHeldObjectType;
  objectId: string;
  attachedState: Readonly<Record<string, unknown>>;
}

async function rowsOf<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute<T>(query);
  return (result as { rows: T[] }).rows;
}

/** The verification statuses an inquiry's attached state lists as finished (C136.3). */
const FINISHED_VERIFICATIONS = ['passed', 'failed', 'requires_retry', 'needs_review'] as const;

const iso = (at: Date): string => at.toISOString();

/** The kind a case holds behind an id's prefix; `document` is decided by the verification's type. */
const PREFIX_KINDS: Readonly<Record<string, CaseHeldObjectType>> = {
  acc: 'account',
  inq: 'inquiry',
  rep: 'report',
  rpr: 'report-run',
  txn: 'transaction',
  ver: 'verification',
  grphq: 'graph-query',
};

/** The kind behind an id's prefix, or `null` for anything a case cannot hold (C136.1). */
export function heldKindOfId(id: string): CaseHeldObjectType | null {
  const prefix = id.slice(0, Math.max(0, id.lastIndexOf('_')));
  return PREFIX_KINDS[prefix] ?? null;
}

const byPrefix = (ids: readonly string[], kind: CaseHeldObjectType) => [
  ...new Set(ids.filter((id) => heldKindOfId(id) === kind)),
];

/**
 * C136.1, C136.3: each of `ids` this environment holds, with its state now; an id it does not hold
 * is left out, so the caller can name what it could not find.
 */
export async function findAttachableObjects(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<AttachableObject[]> {
  const found: AttachableObject[] = [];
  const accountIds = byPrefix(ids, 'account');
  if (accountIds.length > 0) {
    const rows = await db
      .select({
        id: accounts.id,
        status: accounts.status,
        type: accounts.accountTypeId,
        createdAt: accounts.createdAt,
      })
      .from(accounts)
      .where(and(eq(accounts.environmentId, environmentId), inArray(accounts.id, accountIds)));
    for (const row of rows) {
      found.push({
        objectType: 'account',
        objectId: row.id,
        attachedState: {
          status: row.status,
          'account-type-id': row.type,
          'created-at': iso(row.createdAt),
        },
      });
    }
  }
  const inquiryIds = byPrefix(ids, 'inquiry');
  if (inquiryIds.length > 0) {
    const rows = await db
      .select({
        id: inquiries.id,
        status: inquiries.status,
        template: inquiries.inquiryTemplateId,
        createdAt: inquiries.createdAt,
      })
      .from(inquiries)
      .where(and(eq(inquiries.environmentId, environmentId), inArray(inquiries.id, inquiryIds)));
    const finished = await db
      .select({ id: verifications.id, inquiryId: verifications.inquiryId })
      .from(verifications)
      .where(
        and(
          eq(verifications.environmentId, environmentId),
          inArray(verifications.inquiryId, inquiryIds),
          inArray(verifications.status, [...FINISHED_VERIFICATIONS]),
        ),
      );
    for (const row of rows) {
      found.push({
        objectType: 'inquiry',
        objectId: row.id,
        attachedState: {
          status: row.status,
          'inquiry-template-id': row.template,
          'created-at': iso(row.createdAt),
          'verification-ids': finished
            .filter(({ inquiryId }) => inquiryId === row.id)
            .map(({ id }) => id)
            .sort(),
        },
      });
    }
  }
  const reportIds = byPrefix(ids, 'report');
  if (reportIds.length > 0) {
    const rows = await db
      .select({
        id: reports.id,
        status: reports.status,
        type: reports.reportType,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(and(eq(reports.environmentId, environmentId), inArray(reports.id, reportIds)));
    for (const row of rows) {
      found.push({
        objectType: 'report',
        objectId: row.id,
        attachedState: {
          status: row.status,
          'report-type': row.type,
          'created-at': iso(row.createdAt),
        },
      });
    }
  }
  const runIds = byPrefix(ids, 'report-run');
  if (runIds.length > 0) {
    const rows = await db
      .select({
        id: reportRuns.id,
        status: reportRuns.status,
        reportId: reportRuns.reportId,
        runType: reportRuns.runType,
        createdAt: reportRuns.createdAt,
      })
      .from(reportRuns)
      .where(and(eq(reportRuns.environmentId, environmentId), inArray(reportRuns.id, runIds)));
    for (const row of rows) {
      found.push({
        objectType: 'report-run',
        objectId: row.id,
        attachedState: {
          status: row.status,
          'run-type': row.runType,
          'report-id': row.reportId,
          'created-at': iso(row.createdAt),
        },
      });
    }
  }
  const transactionIds = byPrefix(ids, 'transaction');
  if (transactionIds.length > 0) {
    const rows = await db
      .select({
        id: transactions.id,
        status: transactions.status,
        type: transactions.transactionTypeId,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.environmentId, environmentId),
          inArray(transactions.id, transactionIds),
        ),
      );
    for (const row of rows) {
      found.push({
        objectType: 'transaction',
        objectId: row.id,
        attachedState: {
          status: row.status,
          'transaction-type-id': row.type,
          'created-at': iso(row.createdAt),
        },
      });
    }
  }
  const verificationIds = byPrefix(ids, 'verification');
  if (verificationIds.length > 0) {
    const rows = await db
      .select({
        id: verifications.id,
        status: verifications.status,
        type: verifications.type,
        createdAt: verifications.createdAt,
      })
      .from(verifications)
      .where(
        and(
          eq(verifications.environmentId, environmentId),
          inArray(verifications.id, verificationIds),
        ),
      );
    for (const row of rows) {
      found.push({
        objectType: row.type === 'document' ? 'document' : 'verification',
        objectId: row.id,
        attachedState: { status: row.status, type: row.type, 'created-at': iso(row.createdAt) },
      });
    }
  }
  const queryIds = byPrefix(ids, 'graph-query');
  if (queryIds.length > 0) {
    const rows = await db
      .select({
        id: graphQueries.id,
        status: graphQueries.status,
        template: graphQueries.graphQueryTemplateId,
        createdAt: graphQueries.createdAt,
      })
      .from(graphQueries)
      .where(
        and(eq(graphQueries.environmentId, environmentId), inArray(graphQueries.id, queryIds)),
      );
    for (const row of rows) {
      found.push({
        objectType: 'graph-query',
        objectId: row.id,
        attachedState: {
          status: row.status,
          'graph-query-template-id': row.template,
          'created-at': iso(row.createdAt),
        },
      });
    }
  }
  return found;
}

/** The ids of the unredacted cases of this environment that hold any of `objectIds`. */
export async function listCasesHolding(
  db: Db,
  environmentId: string,
  objectIds: readonly string[],
): Promise<string[]> {
  if (objectIds.length === 0) {
    return [];
  }
  const ids = sql.join(
    objectIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await rowsOf<{ case_id: string }>(
    db,
    sql`
    select distinct held.case_id from (
      select case_id, environment_id from case_inquiries where inquiry_id in (${ids})
      union all select case_id, environment_id from case_accounts where account_id in (${ids})
      union all select case_id, environment_id from case_reports where report_id in (${ids})
      union all select case_id, environment_id from case_report_runs where report_run_id in (${ids})
      union all select case_id, environment_id from case_transactions where transaction_id in (${ids})
      union all select case_id, environment_id from case_verifications where verification_id in (${ids})
      union all select case_id, environment_id from case_graph_queries where graph_query_id in (${ids})
    ) held
    inner join ${cases} c on c.environment_id = held.environment_id and c.id = held.case_id
    where held.environment_id = ${environmentId} and c.redacted_at is null
    order by held.case_id`,
  );
  return result.map((row) => row.case_id);
}

type AttachRow = Omit<CaseHeldObjectRow, 'attachedAt'>;

const common = (environmentId: string, row: AttachRow) => ({
  environmentId,
  caseId: row.caseId,
  attachedByType: row.attachedByType,
  attachedById: row.attachedById,
  attachedState: { ...row.attachedState },
});

/** Inserts one row of `row`'s kind; answers when it was attached, or `null` for a repeat. */
async function attachOne(tx: Db, environmentId: string, row: AttachRow): Promise<Date | null> {
  const values = common(environmentId, row);
  let rows: { createdAt: Date }[];
  switch (row.objectType) {
    case 'account':
      rows = await tx
        .insert(caseAccounts)
        .values({ ...values, accountId: row.objectId })
        .onConflictDoNothing()
        .returning({ createdAt: caseAccounts.createdAt });
      break;
    case 'inquiry':
      rows = await tx
        .insert(caseInquiries)
        .values({ ...values, inquiryId: row.objectId })
        .onConflictDoNothing()
        .returning({ createdAt: caseInquiries.createdAt });
      break;
    case 'report':
      rows = await tx
        .insert(caseReports)
        .values({ ...values, reportId: row.objectId })
        .onConflictDoNothing()
        .returning({ createdAt: caseReports.createdAt });
      break;
    case 'report-run':
      rows = await tx
        .insert(caseReportRuns)
        .values({ ...values, reportRunId: row.objectId })
        .onConflictDoNothing()
        .returning({ createdAt: caseReportRuns.createdAt });
      break;
    case 'transaction':
      rows = await tx
        .insert(caseTransactions)
        .values({ ...values, transactionId: row.objectId })
        .onConflictDoNothing()
        .returning({ createdAt: caseTransactions.createdAt });
      break;
    case 'verification':
    case 'document':
      rows = await tx
        .insert(caseVerifications)
        .values({ ...values, verificationId: row.objectId, heldAs: row.objectType })
        .onConflictDoNothing()
        .returning({ createdAt: caseVerifications.createdAt });
      break;
    case 'graph-query':
      rows = await tx
        .insert(caseGraphQueries)
        .values({ ...values, graphQueryId: row.objectId })
        .onConflictDoNothing()
        .returning({ createdAt: caseGraphQueries.createdAt });
      break;
  }
  return rows[0]?.createdAt ?? null;
}

/** C136.2: attaches each row once; answers the rows newly attached (a repeat is no change). */
export async function attachCaseObjects(
  tx: Db,
  environmentId: string,
  rows: readonly AttachRow[],
): Promise<CaseHeldObjectRow[]> {
  const attached: CaseHeldObjectRow[] = [];
  for (const row of rows) {
    const at = await attachOne(tx, environmentId, row);
    if (at !== null) {
      attached.push({ ...row, attachedAt: at });
    }
  }
  return attached;
}

/** C136.2: removes what the case holds of `objectIds`; answers what it removed (absent is a no-op). */
export async function removeCaseObjects(
  tx: Db,
  environmentId: string,
  caseId: string,
  objectIds: readonly string[],
): Promise<{ objectType: CaseHeldObjectType; objectId: string }[]> {
  const removed: { objectType: CaseHeldObjectType; objectId: string }[] = [];
  const ids = [...new Set(objectIds)];
  if (ids.length === 0) {
    return removed;
  }
  for (const row of await tx
    .delete(caseAccounts)
    .where(
      and(
        eq(caseAccounts.environmentId, environmentId),
        eq(caseAccounts.caseId, caseId),
        inArray(caseAccounts.accountId, ids),
      ),
    )
    .returning({ id: caseAccounts.accountId })) {
    removed.push({ objectType: 'account', objectId: row.id });
  }
  for (const row of await tx
    .delete(caseInquiries)
    .where(
      and(
        eq(caseInquiries.environmentId, environmentId),
        eq(caseInquiries.caseId, caseId),
        inArray(caseInquiries.inquiryId, ids),
      ),
    )
    .returning({ id: caseInquiries.inquiryId })) {
    removed.push({ objectType: 'inquiry', objectId: row.id });
  }
  for (const row of await tx
    .delete(caseReports)
    .where(
      and(
        eq(caseReports.environmentId, environmentId),
        eq(caseReports.caseId, caseId),
        inArray(caseReports.reportId, ids),
      ),
    )
    .returning({ id: caseReports.reportId })) {
    removed.push({ objectType: 'report', objectId: row.id });
  }
  for (const row of await tx
    .delete(caseReportRuns)
    .where(
      and(
        eq(caseReportRuns.environmentId, environmentId),
        eq(caseReportRuns.caseId, caseId),
        inArray(caseReportRuns.reportRunId, ids),
      ),
    )
    .returning({ id: caseReportRuns.reportRunId })) {
    removed.push({ objectType: 'report-run', objectId: row.id });
  }
  for (const row of await tx
    .delete(caseTransactions)
    .where(
      and(
        eq(caseTransactions.environmentId, environmentId),
        eq(caseTransactions.caseId, caseId),
        inArray(caseTransactions.transactionId, ids),
      ),
    )
    .returning({ id: caseTransactions.transactionId })) {
    removed.push({ objectType: 'transaction', objectId: row.id });
  }
  for (const row of await tx
    .delete(caseVerifications)
    .where(
      and(
        eq(caseVerifications.environmentId, environmentId),
        eq(caseVerifications.caseId, caseId),
        inArray(caseVerifications.verificationId, ids),
      ),
    )
    .returning({ id: caseVerifications.verificationId, heldAs: caseVerifications.heldAs })) {
    removed.push({ objectType: row.heldAs, objectId: row.id });
  }
  for (const row of await tx
    .delete(caseGraphQueries)
    .where(
      and(
        eq(caseGraphQueries.environmentId, environmentId),
        eq(caseGraphQueries.caseId, caseId),
        inArray(caseGraphQueries.graphQueryId, ids),
      ),
    )
    .returning({ id: caseGraphQueries.graphQueryId })) {
    removed.push({ objectType: 'graph-query', objectId: row.id });
  }
  return removed;
}

/** The union of the held tables, typed, as one relation (`held`). */
const HELD_UNION = sql`(
  select environment_id, case_id, 'account' as object_type, account_id as object_id,
    attached_by_type, attached_by_id, attached_state, created_at from case_accounts
  union all select environment_id, case_id, 'inquiry', inquiry_id, attached_by_type, attached_by_id,
    attached_state, created_at from case_inquiries
  union all select environment_id, case_id, 'report', report_id, attached_by_type, attached_by_id,
    attached_state, created_at from case_reports
  union all select environment_id, case_id, 'report-run', report_run_id, attached_by_type,
    attached_by_id, attached_state, created_at from case_report_runs
  union all select environment_id, case_id, 'transaction', transaction_id, attached_by_type,
    attached_by_id, attached_state, created_at from case_transactions
  union all select environment_id, case_id, held_as, verification_id, attached_by_type,
    attached_by_id, attached_state, created_at from case_verifications
  union all select environment_id, case_id, 'graph-query', graph_query_id, attached_by_type,
    attached_by_id, attached_state, created_at from case_graph_queries
) held`;

/** C136.1: how many objects the case holds, of every kind (the 1,000 cap). */
export async function countCaseObjects(
  db: Db,
  environmentId: string,
  caseId: string,
): Promise<number> {
  const result = await rowsOf<{ total: string | number }>(
    db,
    sql`
    select count(*) as total from ${HELD_UNION}
    where held.environment_id = ${environmentId} and held.case_id = ${caseId}`,
  );
  return Number(result[0]?.total ?? 0);
}

interface HeldDbRow extends Record<string, unknown> {
  object_type: CaseHeldObjectType;
  object_id: string;
  attached_by_type: 'user' | 'api-key' | 'workflow-run';
  attached_by_id: string;
  attached_state: Record<string, unknown>;
  created_at: string | Date;
}

/**
 * `GET /cases/:id/objects` (Stage 1a amendment 19): every object the case holds with its attached
 * state, newest first by `(attached-at, object id)`, paged by `<case>:<object>`.
 * @throws {InvalidCursorError} when `after` names nothing the case holds.
 */
export async function listCaseHeldObjectRows(
  db: Db,
  environmentId: string,
  caseId: string,
  options: {
    objectTypes?: readonly CaseHeldObjectType[] | undefined;
    afterObjectId?: string | undefined;
    size?: number | undefined;
  },
): Promise<Page<CaseHeldObjectRow>> {
  const size = pageSize(options.size);
  const types =
    options.objectTypes === undefined
      ? sql`true`
      : options.objectTypes.length === 0
        ? sql`false`
        : sql`held.object_type in (${sql.join(
            options.objectTypes.map((type) => sql`${type}`),
            sql`, `,
          )})`;
  let after = sql`true`;
  if (options.afterObjectId !== undefined) {
    const found = await rowsOf<{ created_at: string }>(
      db,
      sql`
      select held.created_at::text as created_at from ${HELD_UNION}
      where held.environment_id = ${environmentId} and held.case_id = ${caseId}
        and held.object_id = ${options.afterObjectId}
      limit 1`,
    );
    const position = found[0];
    if (position === undefined) {
      throw new InvalidCursorError();
    }
    after = sql`(held.created_at, held.object_id) <
      (${position.created_at}::timestamptz, ${options.afterObjectId})`;
  }
  const result = await rowsOf<HeldDbRow>(
    db,
    sql`
    select held.object_type, held.object_id, held.attached_by_type, held.attached_by_id,
      held.attached_state, held.created_at
    from ${HELD_UNION}
    where held.environment_id = ${environmentId} and held.case_id = ${caseId} and ${types}
      and ${after}
    order by held.created_at desc, held.object_id desc
    limit ${size + 1}`,
  );
  const items = result.slice(0, size).map((row): CaseHeldObjectRow => ({
    caseId,
    objectType: row.object_type,
    objectId: row.object_id,
    attachedByType: row.attached_by_type,
    attachedById: row.attached_by_id,
    attachedState: row.attached_state,
    attachedAt: new Date(row.created_at),
  }));
  const last = items.at(-1);
  return {
    items,
    next: result.length > size && last !== undefined ? `${caseId}:${last.objectId}` : null,
  };
}

/**
 * C143.4: the inquiry templates of every inquiry each case holds, sorted: a case's webhook subject
 * matches an inquiry-template filter only when the filter allows every one of them.
 */
export async function listHeldInquiryTemplateIds(
  db: Db,
  environmentId: string,
  caseIds: readonly string[],
): Promise<Map<string, string[]>> {
  const held = new Map<string, string[]>(caseIds.map((id) => [id, []]));
  if (caseIds.length === 0) {
    return held;
  }
  const rows = await db
    .selectDistinct({ caseId: caseInquiries.caseId, templateId: inquiries.inquiryTemplateId })
    .from(caseInquiries)
    .innerJoin(
      inquiries,
      and(
        eq(inquiries.environmentId, caseInquiries.environmentId),
        eq(inquiries.id, caseInquiries.inquiryId),
      ),
    )
    .where(
      and(
        eq(caseInquiries.environmentId, environmentId),
        inArray(caseInquiries.caseId, [...caseIds]),
      ),
    );
  for (const { caseId, templateId } of rows) {
    held.get(caseId)?.push(templateId);
  }
  for (const list of held.values()) {
    list.sort();
  }
  return held;
}

/** The unredacted case ids among `caseIds` (a held object's module reads only live cases). */
export async function unredactedCaseIds(
  db: Db,
  environmentId: string,
  caseIds: readonly string[],
): Promise<string[]> {
  if (caseIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.environmentId, environmentId),
        inArray(cases.id, [...caseIds]),
        isNull(cases.redactedAt),
      ),
    );
  return rows.map(({ id }) => id).sort();
}
