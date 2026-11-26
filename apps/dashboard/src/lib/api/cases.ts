/**
 * Case reads and the case action runner of the case console (C129, C137, C142.1), through the server
 * API with the operator's session. A case's `fields` and its attachments' filenames come masked for
 * an operator without `pii:view` (C136.4, C135): what a page shows is what these answered, and the
 * console never unmasks. Failures are `@openverify/node` errors, which `renderPage` maps.
 */
import 'server-only';
import { caseBulkActionDocumentSchema, caseListDocumentSchema } from '@openverify/contracts';
import type { CaseFilters } from '../../components/cases/case-query';
import { describeCaseProblem } from '../../components/cases/case-words';
import { runAction, type ActionContext, type ActionGuard, type ActionResult } from './action';
import { apiRequest } from './client';

/** Cases and notifications per list page. */
export const CASES_PAGE_SIZE = 25;

/** `GET /cases`: one page, newest first, by the C129.5 filters. */
export function listCases(filters: CaseFilters, after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/cases',
    query: {
      'filter[status]': filters.status,
      'filter[case-template-id]': filters.templateId,
      'filter[case-queue-id]': filters.queueId,
      'filter[assignee-id]': filters.assigneeId,
      'filter[status-category]': filters.category,
      'filter[sla-state]': filters.slaState,
      'filter[account-id]': filters.accountId,
      'filter[inquiry-id]': filters.inquiryId,
      'filter[report-id]': filters.reportId,
      'filter[reference-id]': filters.referenceId,
      'page[after]': after,
      'page[size]': String(CASES_PAGE_SIZE),
    },
    schema: caseListDocumentSchema,
  });
}

/** `GET /case-bulk-actions/:id`: the creating principal's own (8B Stage 1a amendment 19). */
export function getCaseBulkAction(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/case-bulk-actions/${encodeURIComponent(id)}`,
    schema: caseBulkActionDocumentSchema,
  });
}

/**
 * `runAction`, with a refusal by a case problem code titled in words (`describeCaseProblem`); a
 * refusal without one keeps the API's words.
 */
export async function runCaseAction<Data>(
  guard: ActionGuard,
  run: (context: ActionContext) => Promise<Data>,
): Promise<ActionResult<Data>> {
  const result = await runAction(guard, run);
  return result.ok ? result : { ok: false, problem: describeCaseProblem(result.problem) };
}
