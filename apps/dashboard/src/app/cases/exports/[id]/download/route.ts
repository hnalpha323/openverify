import { idSchema } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { getApiClient } from '../../../../../lib/api/client';
import { getSession, hasPermission } from '../../../../../lib/api/me';
import { getSessionToken } from '../../../../../lib/session';

/**
 * API statuses passed on: no session, no `cases:export` (or no `pii:view` for personal data), not the
 * caller's or not written yet (404), and deleted after its 24 hours (410).
 */
const PASSED_ON: ReadonlySet<number> = new Set([401, 403, 404, 410]);
/** As the API answers it: an export is never stored by browsers or proxies. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const;

const empty = (status: number): Response => new Response(null, { status, headers: NO_STORE });

/**
 * `GET /cases/exports/:id/download`: an export's file (C138.1, P26), read with the operator's session
 * through `caseExports.download` and passed on as a download named by the server
 * (`case-export-<id>.csv|json`), never rendered and never stored. Only its creator gets it, and each
 * download re-checks `cases:export` (and `pii:view` when it holds personal data) in the API, which
 * audits it. Without `cases:export` nothing is asked. API errors are reduced to a status without a
 * body. The request carries the BFF headers, so the audit entry records the operator's address (C21).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!idSchema('cexp').safeParse(id).success) {
    return empty(404);
  }
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return empty(401);
  }
  let file: { bytes: Uint8Array; mimeType: string | null };
  try {
    if (!hasPermission(await getSession(), 'cases:export')) {
      return empty(403);
    }
    const api = await getApiClient();
    file = await api.caseExports.download(id);
  } catch (error) {
    return empty(
      error instanceof OpenVerifyApiError && PASSED_ON.has(error.status) ? error.status : 502,
    );
  }
  const json = file.mimeType?.includes('json') === true;
  // The client read these bytes into an ArrayBuffer of its own, so no copy is needed.
  return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      ...NO_STORE,
      // The API writes both formats in UTF-8 (C138.2).
      'content-type': json ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="case-export-${id}.${json ? 'json' : 'csv'}"`,
      'x-content-type-options': 'nosniff',
    },
  });
}
