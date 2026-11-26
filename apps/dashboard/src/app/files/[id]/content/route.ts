import { fetchFileContent } from '../../../../lib/dashboard-api';

/** A C1 file ID: `file_` and a ULID. */
const FILE_ID = /^file_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** API statuses passed on: no session, no `pii:view` (C15), unknown, redacted (C16). */
const PASSED_ON: ReadonlySet<number> = new Set([401, 403, 404, 410]);
/** Same as the API (C4): ID images and selfies are never stored by browsers or proxies. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const;

const empty = (status: number): Response => new Response(null, { status, headers: NO_STORE });

/**
 * Reads an unwanted upstream body to the end, so the connection can be reused. It must not
 * be cancelled instead: Next.js dedupes GET fetches by tee()ing the response and keeping the
 * other branch, and cancelling one tee branch only settles once both are cancelled, so
 * `await body.cancel()` would hang the request. Error bodies are small problem documents.
 */
async function drain(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // A broken upstream body changes nothing about the answer.
  }
}

/**
 * `GET /files/:id/content`: streams a decrypted upload from the dashboard API to the
 * operator's browser, authenticated with the session cookie, so `<img>` tags work without
 * the token ever reaching client JavaScript. Only accepted image types are passed on, plus a
 * document's PDF when the API answers it as an attachment (it downloads, never renders), and
 * API errors are reduced to a status without a body. The request carries the BFF headers, so the
 * API's `file.viewed` audit entry records the operator's address (C21).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!FILE_ID.test(id)) {
    return empty(404);
  }
  let upstream: Response | null;
  try {
    upstream = await fetchFileContent(id);
  } catch {
    return empty(502);
  }
  if (upstream === null) {
    return empty(401);
  }
  const contentType = upstream.headers.get('content-type') ?? '';
  const disposition = upstream.headers.get('content-disposition') ?? '';
  // C52.4 and C66: a document's PDF passes only as the API's attachment, so it downloads and the
  // browser never renders it.
  const attachedPdf = contentType === 'application/pdf' && /^attachment\b/i.test(disposition);
  if (upstream.status !== 200 || !(IMAGE_TYPES.has(contentType) || attachedPdf)) {
    await drain(upstream);
    return empty(PASSED_ON.has(upstream.status) ? upstream.status : 502);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
      ...(attachedPdf ? { 'content-disposition': disposition } : {}),
    },
  });
}
