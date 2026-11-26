/**
 * Bulk report creation (C166.5, C166.6): `POST /reports/bulk` (multipart: `report-template-id` and
 * the CSV in the part `file`, at most 1,000 rows and 2 MiB; `reports:write` plus each link column's
 * scope; the `report-bulk` policy; 202) and `GET /reports/bulk/:id` (`reports:read`), whose every
 * row is created with its report or failed with its code. The upload is streamed through as the
 * browser sent it (`app/exports/bulk-reports/upload/route.ts`), never buffered or read here: the CSV
 * holds third-party personal data.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { reportBulkJobDocumentSchema } from '@openverify/contracts';
import { apiBaseUrl } from '../config';
import { getSessionToken } from '../session';
import { apiRequest, getBffFetch } from './client';

/** C166.5: 2 MiB of CSV and 64 KiB of multipart framing, as the API's own body limit. */
export const BULK_UPLOAD_LIMIT_BYTES = 2_097_152 + 64 * 1_024;

/** An upload's longest wait: 2 MiB on a slow link, then the API's sealing and storing. */
const UPLOAD_TIMEOUT_MS = 60_000;

export interface BulkReportUpload {
  readonly body: ReadableStream<Uint8Array>;
  /** The browser's `multipart/form-data` type, with its boundary, passed on unchanged. */
  readonly contentType: string;
  /** Aborts the upload, as the route does once a body without a length passes the limit. */
  readonly signal?: AbortSignal;
}

/** `POST /reports/bulk` with the browser's body streamed through; `null` without a session. */
export async function streamReportBulkUpload(upload: BulkReportUpload): Promise<Response | null> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  return bffFetch(`${apiBaseUrl()}/api/v1/reports/bulk`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': upload.contentType,
      // C166.5: one upload is one job, even when the browser or a proxy sends it twice.
      'idempotency-key': randomUUID(),
    },
    body: upload.body,
    // Node's fetch streams a request body only half-duplex.
    duplex: 'half',
    signal:
      upload.signal === undefined
        ? AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
        : AbortSignal.any([upload.signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)]),
  } as RequestInit);
}

/** `GET /reports/bulk/:id`. */
export function getReportBulkJob(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/reports/bulk/${encodeURIComponent(id)}`,
    schema: reportBulkJobDocumentSchema,
  });
}
