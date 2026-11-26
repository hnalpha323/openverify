/**
 * C131.4 (Workflow 8B): the case timeline, append-only (migration 0028's trigger). Owner `api-cases`;
 * `foundation-8b` froze the names. A row holds keys, ids and statuses, never a value.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import type { CaseHistoryKind } from '@openverify/core';
import type { Db } from '../client.js';
import { InvalidCursorError } from '../errors.js';
import { caseHistory, type CaseHistoryActorType, type CaseHistoryRow } from '../tables/cases.js';
import { pageSize, type Page } from './pagination.js';

export interface NewCaseHistoryRow {
  caseId: string;
  kind: CaseHistoryKind;
  actorType: CaseHistoryActorType;
  actorId: string | null;
  from?: Readonly<Record<string, unknown>> | null;
  to?: Readonly<Record<string, unknown>> | null;
  requestId?: string | null;
}

export async function appendCaseHistory(
  tx: Db,
  environmentId: string,
  rows: readonly NewCaseHistoryRow[],
): Promise<CaseHistoryRow[]> {
  if (rows.length === 0) {
    return [];
  }
  return tx
    .insert(caseHistory)
    .values(
      rows.map((row) => ({
        environmentId,
        caseId: row.caseId,
        kind: row.kind,
        actorType: row.actorType,
        actorId: row.actorId,
        from: row.from === undefined || row.from === null ? null : { ...row.from },
        to: row.to === undefined || row.to === null ? null : { ...row.to },
        requestId: row.requestId ?? null,
      })),
    )
    .returning();
}

/**
 * C131.4 (Stage 1a amendment 19): a case's timeline, newest first by the row's number, which is the
 * cursor: `after` is the number of the last row of the previous page.
 * @throws {InvalidCursorError} when `after` names no row of this case.
 */
export async function listCaseHistoryRows(
  db: Db,
  environmentId: string,
  caseId: string,
  page: { after?: number | undefined; size?: number | undefined },
): Promise<Page<CaseHistoryRow>> {
  const size = pageSize(page.size);
  const ofCase = and(eq(caseHistory.environmentId, environmentId), eq(caseHistory.caseId, caseId));
  if (page.after !== undefined) {
    const [found] = await db
      .select({ id: caseHistory.id })
      .from(caseHistory)
      .where(and(ofCase, eq(caseHistory.id, page.after)))
      .limit(1);
    if (found === undefined) {
      throw new InvalidCursorError();
    }
  }
  const rows = await db
    .select()
    .from(caseHistory)
    .where(and(ofCase, page.after === undefined ? undefined : lt(caseHistory.id, page.after)))
    .orderBy(desc(caseHistory.id))
    .limit(size + 1);
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return { items, next: rows.length > size && last !== undefined ? String(last.id) : null };
}
