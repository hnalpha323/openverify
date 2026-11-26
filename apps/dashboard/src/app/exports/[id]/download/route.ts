import { idSchema } from '@openverify/contracts';
import { EXPORT_PERMISSIONS } from '@openverify/core';
import { OpenVerifyApiError } from '@openverify/node';
import { downloadExport } from '../../../../lib/api/exports';
import { getSession } from '../../../../lib/api/me';
import { getSessionToken } from '../../../../lib/session';

/**
 * API statuses passed on: no session, a lost type permission (or personal data without
 * `pii:view`), not the caller's or not written yet (404), and deleted after its 24 hours (410).
 */
const PASSED_ON: ReadonlySet<number> = new Set([401, 403, 404, 410]);
/** As the API answers it: an export is never stored by browsers or proxies. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const;

const empty = (status: number): Response => new Response(null, { status, headers: NO_STORE });

/**
 * `GET /exports/:id/download` (C166.1, C166.4): an export's CSV, read with the operator's session and
 * passed on as a download (`export-<id>.csv`), never rendered and never stored. Only its creator gets
 * it, and the API re-checks the type's permission (and `pii:view` for personal data) on every
 * download and audits it. A reader holding no `:export` is refused before the API is asked. API
 * errors are reduced to a status without a body.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!idSchema('exp').safeParse(id).success) {
    return empty(404);
  }
  if ((await getSessionToken()) === null) {
    return empty(401);
  }
  let file: { bytes: Uint8Array; mimeType: string | null };
  try {
    const session = await getSession();
    if (
      !Object.values(EXPORT_PERMISSIONS).some((permission) => session.permissions.has(permission))
    ) {
      return empty(403);
    }
    file = await downloadExport(id);
  } catch (error) {
    return empty(
      error instanceof OpenVerifyApiError && PASSED_ON.has(error.status) ? error.status : 502,
    );
  }
  return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="export-${id}.csv"`,
      'x-content-type-options': 'nosniff',
    },
  });
}
