/**
 * Case export reads of the case console (C138.1, C142.1), under `cases:export`: the caller's own
 * exports alone (P26), which the API answers to their creator and nobody else. An export names no
 * filter and no value. Failures are `@openverify/node` errors, which `renderPage` maps.
 */
import 'server-only';
import { caseExportListDocumentSchema } from '@openverify/contracts';
import { apiRequest } from './client';

export const CASE_EXPORTS_PAGE_SIZE = 25;

/** `GET /case-exports`: the caller's own, newest first. */
export function listCaseExports(after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/case-exports',
    query: { 'page[after]': after, 'page[size]': String(CASE_EXPORTS_PAGE_SIZE) },
    schema: caseExportListDocumentSchema,
  });
}
