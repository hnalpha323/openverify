/**
 * C135.1, C135.4: a case attachment's upload and rendition, sent on the C21 BFF layer for the
 * console's own routes (`app/cases/[id]/attachments/`). The upload is streamed as the browser sent
 * it, never buffered here, so a 10 MiB file passes neither a server action's 1 MB limit nor the
 * proxy's buffer; the API types it by its magic bytes, caps it, scans it and seals it. The session
 * token comes from the httpOnly cookie, and every request carries the operator's address and the
 * BFF token, so the API's audit entries record who and from where.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { apiBaseUrl } from '../config';
import { getSessionToken } from '../session';
import { getBffFetch } from './client';

/** C135.1: 10 MiB a file, and 64 KiB of multipart framing, as the API's own body limit. */
export const UPLOAD_LIMIT_BYTES = 10 * 1_048_576 + 64 * 1_024;

/** An upload's longest wait: a 10 MiB body on a slow link, then the API's sealing and storing. */
const UPLOAD_TIMEOUT_MS = 120_000;

export interface AttachmentUpload {
  readonly body: ReadableStream<Uint8Array>;
  /** The browser's `multipart/form-data` type, with its boundary, passed on unchanged. */
  readonly contentType: string;
  /** Aborts the upload, as the route does once a body without a length passes the limit. */
  readonly signal?: AbortSignal;
}

const casePath = (caseId: string) => `${apiBaseUrl()}/api/v1/cases/${encodeURIComponent(caseId)}`;

/**
 * `POST /cases/:id/attachments` with the browser's multipart body streamed through (`duplex:
 * 'half'`), and an `Idempotency-Key` of its own, so the API never stores one upload twice (C135.1).
 * Answers the raw response; `null` without a session.
 */
export async function streamCaseAttachmentUpload(
  caseId: string,
  upload: AttachmentUpload,
): Promise<Response | null> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  return bffFetch(`${casePath(caseId)}/attachments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': upload.contentType,
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

/**
 * `GET /cases/:id/attachments/:attachmentId/content` (C135.4): the rendition's page, never the
 * original. Answers the raw response; `null` without a session.
 */
export async function fetchCaseAttachmentContent(
  caseId: string,
  attachmentId: string,
  page?: number,
): Promise<Response | null> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  const query = page === undefined ? '' : `?page=${String(page)}`;
  return bffFetch(
    `${casePath(caseId)}/attachments/${encodeURIComponent(attachmentId)}/content${query}`,
    { headers: { authorization: `Bearer ${token}`, accept: 'image/*' } },
  );
}
