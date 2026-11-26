import { idSchema } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { getApiClient } from '../../../../../../lib/api/client';
import { getSession, hasPermission } from '../../../../../../lib/api/me';
import { getSessionToken } from '../../../../../../lib/session';

/** API statuses passed on: no session, no `pii:view`, unknown or replaced, redacted (C105.2). */
const PASSED_ON: ReadonlySet<number> = new Set([401, 403, 404, 410]);
/** As the API answers it: a file of a transaction is never stored by browsers or proxies. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const;

const empty = (status: number): Response => new Response(null, { status, headers: NO_STORE });

/**
 * `GET /transactions/:id/files/:fileId/content`: a transaction file's bytes (C105.2, P12), read with
 * the operator's session through `transactions.fileContent` (K7B-9) and passed on as a download, never rendered and never stored. It needs
 * `pii:view` (the API checks it too, and audits the read); without it nothing is asked. API errors
 * are reduced to a status without a body. The request carries the BFF headers, so the API's audit
 * entry records the operator's address (C21).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
): Promise<Response> {
  const { id, fileId } = await params;
  if (!idSchema('txn').safeParse(id).success || !idSchema('txnf').safeParse(fileId).success) {
    return empty(404);
  }
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return empty(401);
  }
  let bytes: Uint8Array;
  try {
    if (!hasPermission(await getSession(), 'transactions:read', 'pii:view')) {
      return empty(403);
    }
    const api = await getApiClient();
    ({ bytes } = await api.transactions.fileContent(id, fileId));
  } catch (error) {
    return empty(
      error instanceof OpenVerifyApiError && PASSED_ON.has(error.status) ? error.status : 502,
    );
  }
  // The client read these bytes into an ArrayBuffer of its own, so no copy is needed.
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${fileId}"`,
      'x-content-type-options': 'nosniff',
    },
  });
}
