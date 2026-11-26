/**
 * C134 (Workflow 8B): case comments. Owner `api-cases`; `foundation-8b` froze the names. `message` is
 * sealed for its row (`SEALED.caseCommentMessage`) and `null` once redacted.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptional, sealValue } from '../sealed.js';
import { caseComments, type CaseCommentRow } from '../tables/cases.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { firstOrNull, inserted } from './rows.js';

/** A comment with its message opened; `null` once redacted. */
export interface CaseComment extends Omit<CaseCommentRow, 'messageSealed'> {
  message: string | null;
}

export interface NewCaseCommentRow {
  id: string;
  caseId: string;
  /** Opened; sealed by the repository. */
  message: string;
  commenterType: CaseCommentRow['commenterType'];
  commenterId: string;
  mentions: readonly string[];
  workflowRunStepId?: string | null;
}

export function toCaseComment(row: CaseCommentRow): CaseComment {
  const { messageSealed, ...rest } = row;
  return { ...rest, message: openOptional(SEALED.caseCommentMessage, row.id, messageSealed) };
}

const commentIn = (environmentId: string, id: string) =>
  and(eq(caseComments.environmentId, environmentId), eq(caseComments.id, id));

export async function createCaseCommentRow(
  tx: Db,
  environmentId: string,
  input: NewCaseCommentRow,
): Promise<CaseComment> {
  return toCaseComment(
    inserted(
      await tx
        .insert(caseComments)
        .values({
          id: input.id,
          environmentId,
          caseId: input.caseId,
          messageSealed: sealValue(SEALED.caseCommentMessage, input.id, input.message),
          commenterType: input.commenterType,
          commenterId: input.commenterId,
          mentions: [...input.mentions],
          workflowRunStepId: input.workflowRunStepId ?? null,
        })
        .returning(),
      'createCaseCommentRow',
    ),
  );
}

export async function getCaseCommentRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseComment | null> {
  const row = firstOrNull(
    await db.select().from(caseComments).where(commentIn(environmentId, id)).limit(1),
  );
  return row === null ? null : toCaseComment(row);
}

const commentCursor = environmentCursor(caseComments);

/** C134.1: a case's comments, newest first (C1). */
export async function listCaseCommentRows(
  db: Db,
  environmentId: string,
  caseId: string,
  page: PageRequest,
): Promise<Page<CaseComment>> {
  const result = await paginate(db, commentCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(caseComments)
      .where(
        and(eq(caseComments.environmentId, environmentId), eq(caseComments.caseId, caseId), after),
      )
      .orderBy(...newestFirst(commentCursor))
      .limit(limit),
  );
  return { items: result.items.map(toCaseComment), next: result.next };
}

/** C134.2: nulls one comment's message; `null` when it was redacted already or is not here. */
export async function redactCaseCommentRow(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<CaseComment | null> {
  const row = firstOrNull(
    await tx
      .update(caseComments)
      .set({ messageSealed: null, redactedAt: at })
      .where(and(commentIn(environmentId, id), isNull(caseComments.redactedAt)))
      .returning(),
  );
  return row === null ? null : toCaseComment(row);
}

/** C139.1: nulls the message of every comment of these cases; answers how many it changed. */
export async function redactCaseCommentRows(
  tx: Db,
  environmentId: string,
  caseIds: readonly string[],
  at: Date = new Date(),
): Promise<number> {
  if (caseIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(caseComments)
    .set({ messageSealed: null, redactedAt: at })
    .where(
      and(
        eq(caseComments.environmentId, environmentId),
        inArray(caseComments.caseId, [...caseIds]),
        isNull(caseComments.redactedAt),
      ),
    )
    .returning({ id: caseComments.id });
  return rows.length;
}

/** The comment ids of these cases: what a case's redaction stubs and forgets. */
export async function listCaseCommentIds(
  db: Db,
  environmentId: string,
  caseIds: readonly string[],
): Promise<string[]> {
  if (caseIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: caseComments.id })
    .from(caseComments)
    .where(
      and(
        eq(caseComments.environmentId, environmentId),
        inArray(caseComments.caseId, [...caseIds]),
      ),
    );
  return rows.map(({ id }) => id).sort();
}

/**
 * C120.9 (P20): of `ids`, the comments that are unredacted: a run's copies into comments are
 * redacted with their source.
 */
export async function redactCaseCommentsById(
  tx: Db,
  environmentId: string,
  ids: readonly string[],
  at: Date,
): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await tx
    .update(caseComments)
    .set({ messageSealed: null, redactedAt: at })
    .where(
      and(
        eq(caseComments.environmentId, environmentId),
        inArray(caseComments.id, [...ids]),
        isNull(caseComments.redactedAt),
      ),
    )
    .returning({ id: caseComments.id });
  return rows.map(({ id }) => id).sort();
}
