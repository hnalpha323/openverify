/**
 * The graph export (C103.2), on the C21 BFF layer: `graphQueries.exportCsv` of the node client
 * (K7B-9), which sends a new `Idempotency-Key` for each export, with the operator's session and
 * the BFF headers. The API answers `text/csv`, already neutralised against formulas by its writer
 * (C100.6), and `app/graph/[id]/export/route.ts` passes it on unparsed. `exportCsv` answers only the
 * text, so this client's `fetch` asks for CSV and records the type the API answered, which lets
 * the route refuse an answer that is not CSV.
 */
import 'server-only';
import { createClient } from '@openverify/node';
import { apiBaseUrl } from '../config';
import { getSessionToken } from '../session';
import { getBffFetch } from './client';
import { API_TIMEOUT_MS } from './http';

export type GraphExportSelection =
  { readonly all: true } | { readonly 'account-ids': readonly string[] };

export interface GraphExport {
  readonly csv: string;
  /** The answer's `content-type`, empty when the API sent none. */
  readonly contentType: string;
}

/**
 * The export of `selection`, or `null` without a session.
 * @throws what the node client throws, such as `OpenVerifyApiError` for a refusal.
 */
export async function exportGraphCsv(
  queryId: string,
  selection: GraphExportSelection,
): Promise<GraphExport | null> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  let contentType = '';
  const client = createClient({
    apiKey: token,
    baseUrl: apiBaseUrl(),
    // A failed export is the operator's to retry, as every other console call is.
    maxRetries: 0,
    timeoutMs: API_TIMEOUT_MS,
    fetch: async (input, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('accept', 'text/csv');
      const response = await bffFetch(input, { ...init, headers });
      contentType = response.headers.get('content-type') ?? '';
      return response;
    },
  });
  const csv = await client.graphQueries.exportCsv(queryId, selection);
  return { csv, contentType };
}
