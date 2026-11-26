/**
 * Queue reads of the case console (C132.1, C142.1), under `case-queues:read`. A queue holds
 * configuration and operator ids, never a subject's data. Failures are `@openverify/node` errors,
 * which `renderPage` maps.
 */
import 'server-only';
import { caseQueueDocumentSchema, caseQueueListDocumentSchema } from '@openverify/contracts';
import type { CaseQueueStatus } from '@openverify/core';
import { apiRequest } from './client';

export const CASE_QUEUES_PAGE_SIZE = 25;
/** The queues a choice offers, from one page. */
export const CASE_QUEUE_CHOICES = 100;

export interface CaseQueueFilters {
  readonly status?: CaseQueueStatus | undefined;
  /** A person's queues (`filter[member-id]`). */
  readonly memberId?: string | undefined;
}

/** `GET /case-queues`: one page, newest first. */
export function listCaseQueues(
  filters: CaseQueueFilters = {},
  options: { readonly after?: string | undefined; readonly size?: number } = {},
) {
  return apiRequest({
    method: 'GET',
    path: '/case-queues',
    query: {
      'filter[status]': filters.status,
      'filter[member-id]': filters.memberId,
      'page[after]': options.after,
      'page[size]': String(options.size ?? CASE_QUEUES_PAGE_SIZE),
    },
    schema: caseQueueListDocumentSchema,
  });
}

/** `GET /case-queues/:id`, with its members. */
export function getCaseQueue(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/case-queues/${encodeURIComponent(id)}`,
    schema: caseQueueDocumentSchema,
  });
}
