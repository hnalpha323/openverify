/**
 * Exports (C166.1-C166.4, C166.6) with the operator's session: `GET /exports` (the caller's own, of
 * the types it still holds `:export` for), `GET /exports/:id`, `POST /exports` (the type's
 * `:export`, then the `exports` policy; 202) and the download (`text/csv`, re-checked by the API,
 * which audits it). An export records its filter's shape, never a value; only its creator sees it.
 * Failures are `@openverify/node` errors, which `renderPage` and `runAction` map.
 */
import 'server-only';
import {
  exportDocumentSchema,
  exportListDocumentSchema,
  type CreateExportBody,
} from '@openverify/contracts';
import { apiRequest, getApiClient } from './client';

export const EXPORTS_PAGE_SIZE = 25;

/** `GET /exports`: one page of the caller's own, newest first. */
export function listExports(after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/exports',
    query: { 'page[after]': after, 'page[size]': String(EXPORTS_PAGE_SIZE) },
    schema: exportListDocumentSchema,
  });
}

/** `GET /exports/:id`. */
export function getExport(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/exports/${encodeURIComponent(id)}`,
    schema: exportDocumentSchema,
  });
}

/** `POST /exports` (202): the export, pending. */
export function createExport(attributes: CreateExportBody['data']['attributes']) {
  return apiRequest({
    method: 'POST',
    path: '/exports',
    body: { data: { type: 'export', attributes } },
    schema: exportDocumentSchema,
  });
}

/** `GET /exports/:id/download`: the file's bytes, read with the session; the API audits it. */
export async function downloadExport(id: string) {
  const api = await getApiClient();
  return api.exports.download(id);
}
