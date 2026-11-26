/**
 * C134.1, C134.2 (Workflow 8B, `api-cases`): what `routes/server/case-comments.ts` calls.
 *
 * - A case's comments, newest first (C1), each message masked without PII visibility.
 * - Append-only (decision 61): a redaction nulls the message and keeps the ids, the author and the
 *   times; the author redacts their own, anyone else needs `cases:redact` (C134.2). A comment of a
 *   case the reader may not see reads as one that does not exist (P14). A second redaction is no
 *   change.
 */
import type {
  CaseCommentDocument,
  CaseCommentListDocument,
  listCaseCommentsQuerySchema,
  redactCaseCommentBodySchema,
} from '@openverify/contracts';
import {
  forgetStoredResponses,
  getCaseCommentRow,
  listCaseCommentRows,
  redactCaseCommentRow,
  stubEventPayloads,
} from '@openverify/db';
import type { z } from 'zod';
import { NotFoundError, PermissionDeniedError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { caseCommentResource } from './resources.js';
import type { CaseActing } from './service.js';
import {
  assertCaseVisible,
  caseChange,
  CASES_PATH,
  historyActor,
  requireVisibleCase,
} from './shared.js';

/** Newest first, by C1's order; a message is masked without PII visibility. */
export async function listCaseComments(
  deps: ApiDependencies,
  acting: CaseActing,
  caseId: string,
  query: z.infer<typeof listCaseCommentsQuerySchema>,
): Promise<CaseCommentListDocument> {
  await requireVisibleCase(deps.db, acting, caseId);
  const page = await withCursor(() =>
    listCaseCommentRows(deps.db, acting.ctx.environmentId, caseId, pageRequest(query)),
  );
  return {
    data: page.items.map((comment) => caseCommentResource(comment, acting.mask)),
    links: {
      next: nextLink(`${CASES_PATH}/${caseId}/comments`, {}, query, page.next),
    },
  };
}

/** The author, or a holder of `cases:redact` (C134.2). */
export const redactCaseComment: (
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof redactCaseCommentBodySchema>,
) => Promise<CaseCommentDocument> = (deps, acting, id) => redactComment(deps, acting, id);

async function redactComment(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseCommentDocument> {
  const { environmentId } = acting.ctx;
  const found = await getCaseCommentRow(deps.db, environmentId, id);
  if (found === null) {
    throw new NotFoundError(`Case comment ${id} was not found.`);
  }
  await assertCaseVisible(deps.db, acting, found.caseId);
  const author = found.commenterType === acting.actor.type && found.commenterId === acting.actor.id;
  if (!author && !acting.principal.permissions.has('cases:redact')) {
    throw new PermissionDeniedError(
      'Only the comment’s author or a holder of cases:redact redacts it.',
      ['cases:redact'],
    );
  }
  const comment = await caseChange(deps, acting, async (unit) => {
    const redacted = await redactCaseCommentRow(unit.tx, environmentId, id, unit.at);
    if (redacted === null) {
      return found;
    }
    await stubEventPayloads(unit.tx, environmentId, [id], unit.at);
    await forgetStoredResponses(unit.tx, environmentId, [id]);
    await unit.history([
      {
        caseId: found.caseId,
        kind: 'comment-redacted',
        ...historyActor(acting),
        to: { 'comment-id': id },
        requestId: acting.ctx.requestId ?? null,
      },
    ]);
    await unit.audit({
      action: 'case-comment.redacted',
      resourceType: 'case-comment',
      resourceId: id,
      metadata: { 'case-id': found.caseId },
    });
    return redacted;
  });
  return { data: caseCommentResource(comment, acting.mask) };
}
