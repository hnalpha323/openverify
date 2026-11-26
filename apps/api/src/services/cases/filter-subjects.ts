/**
 * C143.4 (F14; Workflow 8B, `api-cases`): the webhook filter subject of a case or case-comment event:
 * the case's template (`case-template-ids`) and the templates of every inquiry it holds, which an
 * inquiry-template filter must all allow. A comment resolves through its case. `events/subject.ts`
 * makes each subject strict, so a payload naming no case of this environment fails any present
 * filter.
 */
import type { WebhookFilterSubject } from '@openverify/core';
import { cases, caseComments, listHeldInquiryTemplateIds, type Db } from '@openverify/db';
import { and, eq, inArray } from 'drizzle-orm';

/** The case a payload names: a case's own id, or a comment's case. */
function caseIdOf(payload: unknown): { caseId?: string; commentId?: string } {
  const data = (
    payload as
      { data?: { type?: unknown; id?: unknown; relationships?: unknown } } | null | undefined
  )?.data;
  if (typeof data?.id !== 'string') {
    return {};
  }
  if (data.type === 'case') {
    return { caseId: data.id };
  }
  if (data.type === 'case-comment') {
    const related = (data.relationships as { case?: { data?: { id?: unknown } } } | undefined)?.case
      ?.data?.id;
    return typeof related === 'string'
      ? { caseId: related, commentId: data.id }
      : { commentId: data.id };
  }
  return {};
}

export async function resolveCaseFilterSubjects(
  db: Db,
  environmentId: string,
  payloads: readonly unknown[],
): Promise<WebhookFilterSubject[]> {
  const named = payloads.map(caseIdOf);
  const orphanComments = named
    .filter(({ caseId, commentId }) => caseId === undefined && commentId !== undefined)
    .map(({ commentId }) => commentId ?? '');
  const commentCases = new Map<string, string>();
  if (orphanComments.length > 0) {
    const rows = await db
      .select({ id: caseComments.id, caseId: caseComments.caseId })
      .from(caseComments)
      .where(
        and(
          eq(caseComments.environmentId, environmentId),
          inArray(caseComments.id, orphanComments),
        ),
      );
    rows.forEach(({ id, caseId }) => commentCases.set(id, caseId));
  }
  const caseIds = named.map(
    ({ caseId, commentId }) =>
      caseId ?? (commentId === undefined ? undefined : commentCases.get(commentId)),
  );
  const wanted = [...new Set(caseIds.filter((id): id is string => id !== undefined))];
  if (wanted.length === 0) {
    return payloads.map(() => ({}));
  }
  const rows = await db
    .select({ id: cases.id, caseTemplateId: cases.caseTemplateId })
    .from(cases)
    .where(and(eq(cases.environmentId, environmentId), inArray(cases.id, wanted)));
  const templates = new Map(rows.map(({ id, caseTemplateId }) => [id, caseTemplateId]));
  const held = await listHeldInquiryTemplateIds(db, environmentId, [...templates.keys()]);
  return caseIds.map((id) => {
    const caseTemplateId = id === undefined ? undefined : templates.get(id);
    return caseTemplateId === undefined || id === undefined
      ? {}
      : { caseTemplateId, heldInquiryTemplateIds: held.get(id) ?? [] };
  });
}
